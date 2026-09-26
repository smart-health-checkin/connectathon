// Response checks for the testing EHR, following the spec's Verifier steps
// (§8.5, [VRS-0]..[VRS-10]) and cross-validation (§6.4, [XV-1]..[XV-14]).
//
// Every check reports pass, fail, warn, or info and cites the requirement it
// comes from. As the spec says for receivers ([RCV-0]..[RCV-2]), only a few
// problems stop processing ("rejected"): an undecodable or undecryptable
// message, no SMART document or response element, invalid response JSON, or a
// response to a different request. mdoc-layer problems (signatures, digests,
// MSO fields, validity window, versions) are warnings. Problems with one
// status row or one Artifact are failures of the wallet, but affect only that
// item or record: the rest of the response is still used ([XV-3], [XV-4]).
// Nothing here throws.
import { type SmartCheckinRequest } from "@smart-health-checkin/client";
import {
  arrayBufferCopy,
  base64UrlDecodeBytes,
  base64UrlEncodeBytes,
  buildDcapiSessionTranscript,
  bytesEqual,
  CborTag,
  cborDecode,
  cborEncode,
  hex,
  hpkeAesGcm,
  hpkeContext,
  hpkeNonce,
  mapGet,
  publicJwkToRawP256,
  sha256,
  verifyDeviceResponseSignatures,
  verifyIssuerAuth,
} from "@smart-health-checkin/client/wire";
import { addLayer, captureRequest, deviceSigTester, diagnoseTranscript, digestRows, hpkeTester, type WireLayers } from "./wire.ts";
export type { WireLayers } from "./wire.ts";

export type Outcome = "pass" | "fail" | "warn" | "info";
export type Check = {
  id: string;
  title: string;
  outcome: Outcome;
  detail: string;
  /** Requirement id in the spec, such as "VRS-6". */
  rule?: string;
  /** Link to that requirement. */
  section?: string;
  /** For warnings: the conformance cases' warning code. */
  code?: string;
  /** What a failure affects: the whole response, one item, or one record. */
  scope?: "response" | "item" | "artifact";
};
export type ArtifactOutcome = "accepted" | "rejected";

const SPEC = "https://smart-health-checkin.org/spec/#";
const DOC_TYPE = "org.smarthealthit.checkin.1";
const NAMESPACE = "org.smarthealthit.checkin";
const ELEMENT = "smart_health_checkin_response";
const STATUS_CODES = new Set(["fulfilled", "partial", "unavailable", "declined", "unsupported", "error"]);
const CORE_MEDIA = new Set(["application/fhir+json", "application/smart-health-card"]);
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type RunInput = {
  request: SmartCheckinRequest;
  credential: unknown;
  verifierKeyPair: CryptoKeyPair;
  verifierPublicJwk: JsonWebKey;
  encryptionInfoBytes: Uint8Array;
  origin: string;
  /** Time to check the MSO validity window against. Default: now. */
  now?: Date;
  /** Verify SMART Health Card signatures against their issuers (network). Default true. */
  verifyHealthCards?: boolean;
  /** For the wire view and diagnosis. */
  navigatorArgument?: unknown;
  deviceRequestBytes?: Uint8Array;
  pageUrl?: string;
  walletOrigin?: string;
};

export type RunResult = {
  checks: Check[];
  /** True when a check says the whole response can't be used. */
  rejected: boolean;
  smartResponse?: any;
  /** Per request item: its valid status, or "unknown" when its status rows are wrong ([XV-3]). */
  items?: Record<string, string>;
  /** Per Artifact id: whether the Verifier uses it ([XV-4]). */
  artifacts?: Record<string, ArtifactOutcome>;
  responseBytes?: number;
  wire?: WireLayers;
};

type Add = (c: Omit<Check, "section"> & { rule?: string }) => void;
const collector = () => {
  const checks: Check[] = [];
  const add: Add = (c) => checks.push({ ...c, section: c.rule ? SPEC + c.rule : undefined });
  return { checks, add };
};

export async function checkResponse(input: RunInput): Promise<RunResult> {
  const { checks, add } = collector();
  const sessionTranscript = await buildDcapiSessionTranscript({ origin: input.origin, encryptionInfo: input.encryptionInfoBytes });
  const wire: WireLayers = await captureRequest({
    origin: input.origin, navigatorArgument: input.navigatorArgument ?? {}, deviceRequestBytes: input.deviceRequestBytes,
    encryptionInfoBytes: input.encryptionInfoBytes, sessionTranscript,
  });
  const done = (extra: Partial<RunResult> = {}): RunResult => ({ checks, wire, rejected: checks.some((c) => c.outcome === "fail" && c.scope === "response"), ...extra });
  const reject = (id: string, title: string, detail: string, rule: string) => add({ id, title, outcome: "fail", detail, rule, scope: "response" });
  const diagnose = (test: (t: Uint8Array) => Promise<boolean>) => diagnoseTranscript({
    origin: input.origin, walletOrigin: input.walletOrigin, pageUrl: input.pageUrl ?? input.origin,
    encryptionInfoBytes: input.encryptionInfoBytes, test,
  });

  // [VRS-2] The credential and data.response.
  const cred = input.credential as { protocol?: string; data?: { response?: unknown } } | undefined;
  add(cred?.protocol === "org-iso-mdoc"
    ? { id: "protocol", title: "Returned protocol is org-iso-mdoc", outcome: "pass", detail: "", rule: "VRS-2" }
    : { id: "protocol", title: "Returned protocol is org-iso-mdoc", outcome: "warn", detail: `got ${JSON.stringify(cred?.protocol)}`, rule: "VRS-2", code: "protocol" });
  const raw = cred?.data?.response;
  if (typeof raw !== "string" || !raw) {
    reject("wrapper", "data.response is base64url", `got ${typeof raw}`, "VRS-2");
    return done();
  }
  if (!/^[A-Za-z0-9_\-+/]+=*$/.test(raw)) {
    reject("wrapper", "data.response is base64url", "contains characters that aren't base64url", "VRS-2");
    return done();
  }
  const response = raw.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  add(response === raw
    ? { id: "wrapper", title: "data.response is unpadded base64url", outcome: "pass", detail: `${raw.length} characters`, rule: "VRS-2" }
    : { id: "wrapper", title: "data.response is unpadded base64url", outcome: "warn", detail: "has padding or standard-base64 characters; decoded anyway", rule: "VRS-2", code: "base64url-padding" });
  addLayer(wire, "dcapi-response", response);

  let dcapi: unknown;
  try {
    dcapi = cborDecode(base64UrlDecodeBytes(response));
  } catch (e) {
    reject("dcapi", "data.response decodes as CBOR", (e as Error).message, "VRS-2");
    return done({ responseBytes: raw.length });
  }
  const fields = Array.isArray(dcapi) ? dcapi[1] : undefined;
  const enc = mapGet(fields, "enc");
  const cipherText = mapGet(fields, "cipherText");
  if (!(enc instanceof Uint8Array) || !(cipherText instanceof Uint8Array)) {
    reject("dcapi", "Response is [\"dcapi\", {enc, cipherText}]", "enc or cipherText is missing", "VRS-2");
    return done({ responseBytes: raw.length });
  }
  add(Array.isArray(dcapi) && dcapi[0] === "dcapi"
    ? { id: "dcapi", title: "Response is [\"dcapi\", {enc, cipherText}]", outcome: "pass", detail: `enc ${enc.length} bytes, cipherText ${cipherText.length} bytes`, rule: "VRS-2" }
    : { id: "dcapi", title: "Response is [\"dcapi\", {enc, cipherText}]", outcome: "warn", detail: `first element is ${JSON.stringify(Array.isArray(dcapi) ? dcapi[0] : dcapi)}`, rule: "VRS-2", code: "dcapi-response" });

  // [VRS-3] Open it with this page's key, bound to this page's origin.
  let deviceResponseBytes: Uint8Array;
  try {
    deviceResponseBytes = await hpkeOpen(enc, cipherText, input.verifierKeyPair, input.verifierPublicJwk, sessionTranscript);
    add({ id: "hpke", title: "Response decrypts with this page's key and origin", outcome: "pass", detail: `${deviceResponseBytes.length} bytes of DeviceResponse`, rule: "VRS-3" });
    addLayer(wire, "device-response", deviceResponseBytes);
    try { wire.digests = await digestRows(deviceResponseBytes); } catch { /* the digest check reports it */ }
  } catch (e) {
    reject("hpke", "Response decrypts with this page's key and origin",
      `${(e as Error).message || "decryption failed"}. Usual causes: the wallet bound the transcript to a different origin, used different encryptionInfo, or the ciphertext is damaged.`,
      "VRS-3");
    const why = await diagnose(hpkeTester(response, input.verifierKeyPair, input.verifierPublicJwk));
    if (why) wire.diagnosis = [`Decryption: ${why}`];
    return done({ responseBytes: raw.length });
  }

  // [VRS-4] The DeviceResponse and our document.
  let dr: unknown;
  try {
    dr = cborDecode(deviceResponseBytes);
  } catch (e) {
    reject("document", "DeviceResponse decodes", (e as Error).message, "VRS-4");
    return done({ responseBytes: raw.length });
  }
  const version = mapGet(dr, "version");
  add(version === "1.0"
    ? { id: "dr-version", title: "DeviceResponse version is 1.0", outcome: "pass", detail: "", rule: "VRS-4" }
    : { id: "dr-version", title: "DeviceResponse version is 1.0", outcome: "warn", detail: `version ${JSON.stringify(version)}`, rule: "VRS-4", code: "device-response-version" });
  const status = mapGet(dr, "status");
  add(status === 0
    ? { id: "dr-status", title: "DeviceResponse status is 0 (OK)", outcome: "pass", detail: "", rule: "VRS-4" }
    : { id: "dr-status", title: "DeviceResponse status is 0 (OK)", outcome: "warn", detail: `status ${JSON.stringify(status)}`, rule: "VRS-4", code: "device-response-status" });
  const documents = mapGet(dr, "documents");
  const docs = Array.isArray(documents) ? documents : [];
  const docIndex = docs.findIndex((d) => mapGet(d, "docType") === DOC_TYPE);
  if (docIndex < 0) {
    reject("document", `A document with docType ${DOC_TYPE}`, docs.length ? `docTypes: ${docs.map((d) => JSON.stringify(mapGet(d, "docType"))).join(", ")}` : "no documents", "VRS-4");
    return done({ responseBytes: raw.length });
  }
  add(docs.length === 1
    ? { id: "document", title: `A document with docType ${DOC_TYPE}`, outcome: "pass", detail: "", rule: "VRS-4" }
    : { id: "document", title: `Exactly one document`, outcome: "warn", detail: `${docs.length} documents; using the first ${DOC_TYPE}`, rule: "VRS-4", code: "documents" });
  const doc = docs[docIndex];
  const issuerSigned = mapGet(doc, "issuerSigned");
  const issuerAuth = mapGet(issuerSigned, "issuerAuth");

  // [VRS-5] issuerAuth and the MSO. Warnings only.
  const now = input.now ?? new Date();
  let mso: unknown;
  try {
    const verified = await verifyIssuerAuth(issuerAuth);
    add(verified.signatureValid
      ? { id: "issuer-sig", title: "Issuer signature (issuerAuth) verifies", outcome: "pass", detail: "", rule: "VRS-5" }
      : { id: "issuer-sig", title: "Issuer signature (issuerAuth) verifies", outcome: "warn", detail: verified.error ?? (verified.present ? "signature does not verify" : "issuerAuth missing"), rule: "VRS-5", code: "issuer-signature" });
    checkAlg(add, issuerAuth, "issuerAuth");
    const payload = Array.isArray(issuerAuth) ? issuerAuth[2] : undefined;
    const tag = payload instanceof Uint8Array ? cborDecode(payload) : undefined;
    mso = tag instanceof CborTag && tag.value instanceof Uint8Array ? cborDecode(tag.value) : undefined;
  } catch (e) {
    add({ id: "issuer-sig", title: "Issuer signature (issuerAuth) verifies", outcome: "warn", detail: (e as Error).message, rule: "VRS-5", code: "issuer-signature" });
  }
  checkMso(add, mso, now);

  // [VRS-6] Value digests. Warnings only.
  await checkDigests(add, issuerSigned, mso);

  // [VRS-7] Device signature over this session. Warnings only.
  try {
    const verifications = await verifyDeviceResponseSignatures({ deviceResponseBytes, sessionTranscript });
    const v = verifications[docIndex];
    const deviceSignature = mapGet(mapGet(mapGet(doc, "deviceSigned"), "deviceAuth"), "deviceSignature");
    if (v?.deviceSignature.signatureValid) {
      add({ id: "device-sig", title: "Device signature verifies over this session", outcome: "pass", detail: Array.isArray(deviceSignature) && deviceSignature[2] === null ? "detached payload" : "attached payload, equal to the expected bytes", rule: "VRS-7" });
    } else {
      add({ id: "device-sig", title: "Device signature verifies over this session", outcome: "warn", detail: v?.deviceSignature.error ?? (v?.deviceSignature.present ? "signature does not verify for this session" : "device signature missing"), rule: "VRS-7", code: "device-signature" });
      if (v?.deviceSignature.present) {
        const why = await diagnose(deviceSigTester(deviceResponseBytes));
        if (why) wire.diagnosis = [...(wire.diagnosis ?? []), `Device signature: ${why}`];
      }
    }
    checkAlg(add, deviceSignature, "device signature");
  } catch (e) {
    add({ id: "device-sig", title: "Device signature verifies over this session", outcome: "warn", detail: (e as Error).message, rule: "VRS-7", code: "device-signature" });
  }

  // [VRS-8] The response element.
  const text = findResponseElement(issuerSigned);
  if (typeof text !== "string") {
    reject("element", `${ELEMENT} element is a text string`, text === undefined ? "element not found" : `elementValue is ${typeof text}`, "VRS-8");
    return done({ responseBytes: raw.length });
  }
  add({ id: "element", title: `${ELEMENT} element is a text string`, outcome: "pass", detail: `${text.length} characters`, rule: "VRS-8" });

  // [VRS-9] The SMART response, against the request (§6.4).
  const clinical = await checkSmartResponse(input.request, text, { verifyHealthCards: input.verifyHealthCards ?? true });
  checks.push(...clinical.checks);
  const size = raw.length;
  // Only one combination has a size ceiling: an Android wallet answering through the old
  // 2-argument setGetCredentialResponse, or Chrome below 150, drops responses above ~520 KB.
  // Wallets on androidx.credentials 1.7+ with Chrome 150+ have no transport limit.
  add({ id: "size", title: "Response size", outcome: "info", detail: `${(size / 1024).toFixed(1)} KB base64url${size > 512 * 1024
    ? ". Fine on current platforms; only an Android wallet using the old 2-argument setGetCredentialResponse, or Chrome below 150, would drop a response this size (the cutoff there is about 520 KB)"
    : ""}` });
  return done({ smartResponse: clinical.smartResponse, items: clinical.items, artifacts: clinical.artifacts, responseBytes: size });
}

async function hpkeOpen(enc: Uint8Array, cipherText: Uint8Array, keyPair: CryptoKeyPair, publicJwk: JsonWebKey, info: Uint8Array): Promise<Uint8Array> {
  const ephemeral = await crypto.subtle.importKey("raw", arrayBufferCopy(enc), { name: "ECDH", namedCurve: "P-256" }, true, []);
  const dh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: ephemeral }, keyPair.privateKey, 256));
  const context = await hpkeContext({ dh, enc, recipientPublicBytes: publicJwkToRawP256(publicJwk), info });
  return hpkeAesGcm(false, { key: context.key, nonce: hpkeNonce(context.baseNonce), aad: new Uint8Array(), data: cipherText });
}

/** [ALG-2]: an unknown or unsupported alg is a warning. */
function checkAlg(add: Add, cose: unknown, label: string) {
  if (!Array.isArray(cose) || !(cose[0] instanceof Uint8Array)) return;
  let alg: unknown;
  try { alg = mapGet(cborDecode(cose[0]), 1); } catch { alg = undefined; }
  if (alg !== -7) add({ id: `alg-${label.replace(/\W+/g, "-")}`, title: `${label} uses ES256`, outcome: "warn", detail: `protected header alg is ${JSON.stringify(alg)}; expected -7`, rule: "ALG-2", code: "alg" });
}

/** [VRS-5], [VRS-10]: the MSO's fields and validity window. */
function checkMso(add: Add, mso: unknown, now: Date) {
  if (!(mso instanceof Map)) {
    add({ id: "mso", title: "MSO decodes", outcome: "warn", detail: "issuerAuth payload is not tag 24 around an MSO", rule: "VRS-5", code: "mso" });
    return;
  }
  const problems: string[] = [];
  if (mapGet(mso, "version") !== "1.0") problems.push(`version ${JSON.stringify(mapGet(mso, "version"))}`);
  if (problems.length) add({ id: "mso-fields", title: "MSO fields", outcome: "warn", detail: problems.join("; "), rule: "VRS-5", code: "mso" });
  const docType = mapGet(mso, "docType");
  add(docType === DOC_TYPE
    ? { id: "mso-doctype", title: "MSO docType matches the document", outcome: "pass", detail: "", rule: "VRS-5" }
    : { id: "mso-doctype", title: "MSO docType matches the document", outcome: "warn", detail: `MSO docType ${JSON.stringify(docType)}`, rule: "VRS-5", code: "mso-doc-type" });
  const digestAlgorithm = mapGet(mso, "digestAlgorithm");
  if (digestAlgorithm !== "SHA-256") add({ id: "mso-digest-algorithm", title: "MSO digestAlgorithm is SHA-256", outcome: "warn", detail: `got ${JSON.stringify(digestAlgorithm)}`, rule: "ALG-2", code: "digest-algorithm" });
  const deviceKey = mapGet(mapGet(mso, "deviceKeyInfo"), "deviceKey");
  if (mapGet(deviceKey, 1) !== 2 || mapGet(deviceKey, -1) !== 1) add({ id: "alg-device-key", title: "Device key is a P-256 EC2 key", outcome: "warn", detail: `kty ${JSON.stringify(mapGet(deviceKey, 1))}, crv ${JSON.stringify(mapGet(deviceKey, -1))}`, rule: "ALG-2", code: "alg" });
  const validity = mapGet(mso, "validityInfo");
  const date = (key: string): Date | undefined => {
    const v = mapGet(validity, key);
    return v instanceof CborTag && v.tag === 0 && typeof v.value === "string" && !isNaN(Date.parse(v.value)) ? new Date(v.value) : undefined;
  };
  const [signed, validFrom, validUntil] = [date("signed"), date("validFrom"), date("validUntil")];
  if (!signed || !validFrom || !validUntil) {
    add({ id: "validity", title: "MSO validityInfo is present", outcome: "warn", detail: "signed, validFrom, and validUntil must each be a tag-0 date-time", rule: "VRS-5", code: "mso-validity-info" });
    return;
  }
  const inWindow = validFrom.getTime() - CLOCK_SKEW_MS <= now.getTime() && now.getTime() <= validUntil.getTime() + CLOCK_SKEW_MS;
  add(inWindow
    ? { id: "validity", title: "MSO is valid now", outcome: "pass", detail: `${validFrom.toISOString()} to ${validUntil.toISOString()}`, rule: "VRS-10" }
    : { id: "validity", title: "MSO is valid now", outcome: "warn", detail: `valid ${validFrom.toISOString()} to ${validUntil.toISOString()}, checked at ${now.toISOString()}`, rule: "VRS-10", code: "mso-validity" });
}

/** [VRS-6]: SHA-256 of each IssuerSignedItemBytes, as received, against the MSO. */
async function checkDigests(add: Add, issuerSigned: unknown, mso: unknown) {
  const items = mapGet(mapGet(issuerSigned, "nameSpaces"), NAMESPACE);
  const expected = mapGet(mapGet(mso, "valueDigests"), NAMESPACE);
  if (!Array.isArray(items) || !items.length) return;
  const problems: string[] = [];
  let matched = 0;
  for (const item of items) {
    if (!(item instanceof CborTag) || item.tag !== 24 || !(item.value instanceof Uint8Array)) { problems.push("an item isn't tag 24"); continue; }
    let digestID: unknown;
    try { digestID = mapGet(cborDecode(item.value), "digestID"); } catch { problems.push("an item doesn't decode"); continue; }
    const want = expected instanceof Map && typeof digestID === "number" ? expected.get(digestID) : undefined;
    if (!(want instanceof Uint8Array)) { problems.push(`no MSO digest for digestID ${JSON.stringify(digestID)}`); continue; }
    const got = await sha256(cborEncode(item));
    if (bytesEqual(got, want)) matched++;
    else problems.push(`digestID ${digestID}: computed ${hex(got).slice(0, 16)}…, MSO has ${hex(want).slice(0, 16)}…`);
  }
  add(problems.length
    ? { id: "digests", title: "Value digests match the MSO", outcome: "warn", detail: problems.join("; "), rule: "VRS-6", code: "digest" }
    : { id: "digests", title: "Value digests match the MSO", outcome: "pass", detail: `${matched} of ${items.length} matched`, rule: "VRS-6" });
}

/** [VRS-8]: the element's value, undefined if absent. */
function findResponseElement(issuerSigned: unknown): unknown {
  const items = mapGet(mapGet(issuerSigned, "nameSpaces"), NAMESPACE);
  if (!Array.isArray(items)) return undefined;
  for (const item of items) {
    try {
      const inner = item instanceof CborTag && item.value instanceof Uint8Array ? cborDecode(item.value) : item;
      if (mapGet(inner, "elementIdentifier") === ELEMENT) return mapGet(inner, "elementValue");
    } catch { /* not a decodable item */ }
  }
  return undefined;
}

// ---------------------------------------------------------------- §6.4

export type ClinicalResult = {
  checks: Check[];
  rejected: boolean;
  smartResponse?: any;
  items?: Record<string, string>;
  artifacts?: Record<string, ArtifactOutcome>;
};

/**
 * Validate a SMART response against the request, as §6.4 says: only a
 * malformed response or a requestId mismatch rejects it ([XV-1], [XV-2]); a
 * bad status row leaves that item's outcome unknown ([XV-3]); a bad Artifact
 * is set aside on its own ([XV-4]).
 */
export async function checkSmartResponse(request: SmartCheckinRequest, text: string, options: { verifyHealthCards?: boolean } = {}): Promise<ClinicalResult> {
  const { checks, add } = collector();
  const done = (extra: Partial<ClinicalResult> = {}): ClinicalResult => ({ checks, rejected: checks.some((c) => c.outcome === "fail" && c.scope === "response"), ...extra });
  const reject = (id: string, title: string, detail: string, rule: string) => add({ id, title, outcome: "fail", detail, rule, scope: "response" });

  let smart: any;
  try {
    smart = JSON.parse(text);
  } catch (e) {
    reject("json", "Response element parses as JSON", (e as Error).message, "XV-1");
    return done();
  }
  const shapeProblems = [
    smart === null || typeof smart !== "object" || Array.isArray(smart) ? "not a JSON object" : "",
    smart?.type !== "smart-health-checkin-response" ? `type is ${JSON.stringify(smart?.type)}` : "",
    smart?.version !== "1" ? `version is ${JSON.stringify(smart?.version)}` : "",
    !Array.isArray(smart?.artifacts) ? "artifacts is not an array" : "",
    !Array.isArray(smart?.requestStatus) ? "requestStatus is not an array" : "",
  ].filter(Boolean);
  if (shapeProblems.length) {
    reject("shape", "Response has the right type, version, artifacts, and requestStatus", shapeProblems.join("; "), "XV-1");
    return done({ smartResponse: smart });
  }
  add({ id: "shape", title: "Response has the right type, version, artifacts, and requestStatus", outcome: "pass", detail: "", rule: "XV-1" });
  if (smart.requestId !== request.id) {
    reject("request-id", "requestId echoes the request id", `sent ${request.id}, got ${JSON.stringify(smart.requestId)}`, "XV-2");
    return done({ smartResponse: smart });
  }
  add({ id: "request-id", title: "requestId echoes the request id", outcome: "pass", detail: request.id, rule: "XV-2" });

  // [XV-3] One valid status per item; rows for other ids are ignored.
  const itemIds = new Set(request.items.map((i) => i.id));
  const rows: any[] = smart.requestStatus;
  const items: Record<string, string> = {};
  for (const item of request.items) {
    const mine = rows.filter((r) => r?.item === item.id);
    const valid = mine.length === 1 && STATUS_CODES.has(mine[0].status);
    items[item.id] = valid ? mine[0].status : "unknown";
    add(valid
      ? { id: `status-${item.id}`, title: `${item.id}: one valid status`, outcome: "pass", detail: mine[0].status, rule: "XV-3" }
      : { id: `status-${item.id}`, title: `${item.id}: one valid status`, outcome: "fail", scope: "item", rule: mine.length === 1 ? "RSP-3" : "RSP-2",
          detail: mine.length === 0 ? "no status row, so its outcome is unknown" : mine.length > 1 ? `${mine.length} status rows, so its outcome is unknown` : `unknown status code ${JSON.stringify(mine[0].status)}, so its outcome is unknown` });
  }
  const strays = rows.filter((r) => !itemIds.has(r?.item)).map((r) => JSON.stringify(r?.item));
  if (strays.length) add({ id: "status-extra", title: "Status rows name only requested items", outcome: "fail", scope: "item", detail: `rows for ${strays.join(", ")} are ignored`, rule: "RSP-2" });

  // [XV-4]..[XV-10], [XV-13] Each Artifact on its own.
  const artifacts: any[] = smart.artifacts;
  const outcomes: Record<string, ArtifactOutcome> = {};
  const ids = artifacts.map((a) => a?.id);
  const itemById = new Map(request.items.map((i) => [i.id, i]));
  for (const [n, a] of artifacts.entries()) {
    const label = typeof a?.id === "string" && a.id ? a.id : `#${n}`;
    const problems: Array<[string, string]> = [];
    if (typeof a?.id !== "string" || !a.id) problems.push(["XV-5", "no id"]);
    else if (ids.filter((x) => x === a.id).length > 1) problems.push(["XV-5", `another Artifact also has id ${a.id}`]);
    if (typeof a?.mediaType !== "string" || !a.mediaType) problems.push(["XV-5", "no mediaType"]);
    const fulfills: unknown[] = Array.isArray(a?.fulfills) ? a.fulfills : [];
    if (!fulfills.length) problems.push(["XV-5", "fulfills is empty"]);
    const unknownItems = fulfills.filter((f) => typeof f !== "string" || !itemIds.has(f));
    if (unknownItems.length) problems.push(["XV-5", `fulfills names ${unknownItems.map((f) => JSON.stringify(f)).join(", ")}, not in the request`]);
    if (typeof a?.mediaType === "string" && !CORE_MEDIA.has(a.mediaType)) problems.push(["XV-6", `unsupported media type ${a.mediaType}`]);
    for (const f of fulfills) {
      const item = typeof f === "string" ? itemById.get(f) : undefined;
      if (item && !item.accept.includes(a.mediaType)) problems.push(["XV-7", `${item.id} accepts ${item.accept.join(", ")}, not ${a.mediaType}`]);
    }
    if (a?.mediaType === "application/fhir+json") {
      if (typeof a.fhirVersion !== "string" || !a.fhirVersion) problems.push(["XV-8", "no fhirVersion"]);
      else if (request.fhirVersions?.length && !request.fhirVersions.includes(a.fhirVersion)) problems.push(["XV-8", `fhirVersion ${a.fhirVersion} is not in the request's fhirVersions (${request.fhirVersions.join(", ")})`]);
      if (a.value === null || typeof a.value !== "object" || typeof a.value.resourceType !== "string") problems.push(["XV-8", "value is not a FHIR resource"]);
    }
    if (a?.mediaType === "application/smart-health-card") {
      const vc = a.value?.verifiableCredential;
      if (!Array.isArray(vc) || !vc.length || !vc.every((s: unknown) => typeof s === "string" && s)) problems.push(["XV-9", "value.verifiableCredential is not a non-empty list of strings"]);
      if ("fhirVersion" in a) problems.push(["XV-9", "a health card Artifact has no fhirVersion"]);
    }
    for (const f of fulfills) {
      const item = typeof f === "string" ? itemById.get(f) : undefined;
      const content: any = item?.content;
      if (content?.kind === "form.fhir" && content.questionnaireCanonical && a?.value?.resourceType === "QuestionnaireResponse" && a.value.questionnaire !== content.questionnaireCanonical)
        problems.push(["XV-10", `QuestionnaireResponse.questionnaire is ${JSON.stringify(a.value.questionnaire)}; ${item!.id} asked for ${content.questionnaireCanonical}`]);
    }
    if (!problems.length && a?.mediaType === "application/smart-health-card" && options.verifyHealthCards !== false) {
      for (const [k, jws] of (a.value.verifiableCredential as string[]).entries()) {
        const r = await verifyHealthCard(jws);
        add(r.ok
          ? { id: `shc-${label}-${k}`, title: `${label}: SMART Health Card signature verifies`, outcome: "pass", detail: r.detail, rule: "XV-13" }
          : { id: `shc-${label}-${k}`, title: `${label}: SMART Health Card signature verifies`, outcome: "fail", scope: "artifact", detail: `${r.detail}; this record is set aside`, rule: "XV-13" });
        if (!r.ok) problems.push(["XV-13", "health card signature does not verify"]);
      }
    }
    const rejected = problems.length > 0;
    outcomes[label] = rejected ? "rejected" : "accepted";
    const nonShc = problems.filter(([rule]) => rule !== "XV-13");
    if (nonShc.length) add({ id: `artifact-${label}`, title: `${label}: record is usable`, outcome: "fail", scope: "artifact", rule: nonShc[0]![0], detail: `${nonShc.map(([, d]) => d).join("; ")}. This record is set aside; the rest of the response is still used.` });
    else if (!rejected) add({ id: `artifact-${label}`, title: `${label}: record is usable`, outcome: "pass", detail: `${a.mediaType}, fulfills ${fulfills.join(", ")}`, rule: "XV-4" });
    // FORM-5: a form is answered with a QuestionnaireResponse (the Wallet's obligation; the record still counts).
    for (const f of fulfills) {
      const item = typeof f === "string" ? itemById.get(f) : undefined;
      if ((item?.content as any)?.kind === "form.fhir" && a?.mediaType === "application/fhir+json" && a.value?.resourceType !== "QuestionnaireResponse")
        add({ id: `form-${label}`, title: `${label}: form answered with a QuestionnaireResponse`, outcome: "fail", scope: "artifact", detail: `got ${a.value?.resourceType}`, rule: "FORM-5" });
    }
  }

  // Per item: what the usable records say.
  for (const item of request.items) {
    const status = items[item.id];
    const usable = artifacts.filter((a) => outcomes[typeof a?.id === "string" && a.id ? a.id : ""] === "accepted" && (a.fulfills ?? []).includes(item.id));
    if ((status === "fulfilled" || status === "partial") && !usable.length)
      add({ id: `fulfilled-${item.id}`, title: `${item.id}: a ${status} item has a usable record`, outcome: "warn", detail: "no usable Artifact lists this item", rule: "XV-12" });
    const content: any = item.content;
    const versioned = (content.profiles ?? []).filter((p: string) => p.includes("|"));
    if (status === "fulfilled" && versioned.length) {
      const claimed = usable.flatMap((a) => (a.mediaType === "application/fhir+json" ? bundleResources(a.value) : [])).flatMap((r) => r.meta?.profile ?? []);
      const met = versioned.some((p: string) => claimed.includes(p));
      add(met
        ? { id: `versioned-${item.id}`, title: `${item.id}: a record claims the requested profile version`, outcome: "pass", detail: versioned.join(", "), rule: "XV-11" }
        : { id: `versioned-${item.id}`, title: `${item.id}: a record claims the requested profile version`, outcome: "fail", scope: "item", detail: `status is fulfilled, but no record's meta.profile includes ${versioned.join(" or ")}`, rule: "XV-11" });
    }
    if (content.kind === "form.fhir") {
      for (const a of usable.filter((x) => x.value?.resourceType === "QuestionnaireResponse")) {
        const answered = countAnswers(a.value.item);
        add({ id: `answers-${item.id}`, title: `${item.id}: answers returned`, outcome: "info", detail: `${answered} answered item(s)`, rule: "FORM-5" });
      }
    }
    if (content.kind === "selection.fhir" && (content.profiles?.length || content.profilesFrom?.length)) {
      for (const a of usable.filter((x) => x.mediaType === "application/fhir+json")) {
        const resources = bundleResources(a.value);
        const primary = resources.filter((r) => !content.resourceTypes || content.resourceTypes.includes(r.resourceType));
        const matching = primary.filter((r) => (r.meta?.profile ?? []).some((p: string) =>
          (content.profiles ?? []).some((w: string) => p.split("|")[0] === w.split("|")[0] && (!w.includes("|") || p === w)) ||
          (content.profilesFrom ?? []).some((f: string) => p.split("|")[0]!.startsWith(f.split("|")[0]!.replace(/\/+$/, "") + "/"))));
        add({ id: `profile-${item.id}`, title: `${item.id}: returned resources claim a requested profile`, outcome: "info",
          detail: `${matching.length} of ${resources.length} resource(s) declare a requested profile in meta.profile`, rule: "SEL-6" });
      }
    }
  }
  return done({ smartResponse: smart, items, artifacts: outcomes });
}

function countAnswers(items: any[] = []): number {
  return items.reduce((n, i) => n + (i.answer?.length ? 1 : 0) + countAnswers(i.item), 0);
}
function bundleResources(value: any): any[] {
  if (value?.resourceType === "Bundle") return (value.entry ?? []).map((e: any) => e.resource).filter(Boolean);
  return value ? [value] : [];
}

const b64urlDecode = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

/** Verify a SMART Health Card JWS against its issuer's published JWKS. */
export async function verifyHealthCard(jws: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const [h, p, sig] = jws.split(".");
    if (!h || !p || !sig) return { ok: false, detail: "not a compact JWS" };
    const header = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
    if (header.alg !== "ES256" || header.zip !== "DEF") return { ok: false, detail: `header must have alg ES256 and zip DEF, got ${JSON.stringify(header)}` };
    const inflated = new Response(new Blob([b64urlDecode(p) as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw")));
    const payload = JSON.parse(await inflated.text());
    const iss = payload.iss;
    const jwks = await (await fetch(`${iss}/.well-known/jwks.json`)).json();
    const jwk = (jwks.keys ?? []).find((k: any) => k.kid === header.kid);
    if (!jwk) return { ok: false, detail: `no key with kid ${header.kid} at ${iss}/.well-known/jwks.json` };
    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(sig) as Uint8Array<ArrayBuffer>, new TextEncoder().encode(`${h}.${p}`));
    const count = payload.vc?.credentialSubject?.fhirBundle?.entry?.length ?? 0;
    return { ok: valid, detail: `${valid ? "valid" : "INVALID"} signature from ${iss}; ${count} resource(s)` };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

/** Which part of the exchange a check is about. */
export function groupOf(id: string): "Wire" | "SMART response" | "Items" | "Records" | "Info" {
  if (/^(protocol|wrapper|dcapi|hpke|dr-|document|issuer-sig|mso|alg-|digests|device-sig|validity)/.test(id)) return "Wire";
  if (/^(element|json|shape|request-id)/.test(id)) return "SMART response";
  if (/^(artifact-|shc-|form-)/.test(id)) return "Records";
  if (id === "size") return "Info";
  return "Items";
}

/** What a wallet builder should do about a failed or warning check. */
export function fixFor(id: string): string {
  const FIX: Array<[RegExp, string]> = [
    [/^protocol/, "Return the credential with protocol \"org-iso-mdoc\"."],
    [/^wrapper/, "Put the HPKE-sealed response in data.response as unpadded base64url."],
    [/^dcapi/, "Encode the response as CBOR [\"dcapi\", {\"enc\": …, \"cipherText\": …}]."],
    [/^hpke/, "Encrypt to the recipient key in this request's encryptionInfo, and build the SessionTranscript from that exact encryptionInfo string and the EHR page's origin (from the browser, never the message, with no trailing slash)."],
    [/^dr-version/, "Set DeviceResponse.version to \"1.0\"."],
    [/^dr-status/, "Set DeviceResponse.status to 0."],
    [/^document/, "Return exactly one document with docType \"org.smarthealthit.checkin.1\"."],
    [/^issuer-sig/, "Sign issuerAuth (COSE_Sign1, ES256, x5chain in the unprotected header) over the exact tag-24 MSO bytes."],
    [/^mso-doctype/, "Set the MSO's docType to \"org.smarthealthit.checkin.1\"."],
    [/^mso-digest-algorithm/, "Set the MSO's digestAlgorithm to \"SHA-256\"."],
    [/^mso/, "Build the MSO as spec §8.7 describes: version \"1.0\", digestAlgorithm, valueDigests, deviceKeyInfo, docType, validityInfo."],
    [/^validity/, "Set validityInfo signed and validFrom to the signing time and validUntil later, each a tag-0 UTC date-time without fractional seconds."],
    [/^alg-/, "Use ES256 (alg -7) and a P-256 EC2 device key."],
    [/^digests/, "Compute each value digest over the exact tag-24 IssuerSignedItem bytes you send."],
    [/^device-sig/, "Sign DeviceAuthentication over this request's SessionTranscript with the device key in the MSO, with a detached (null) payload."],
    [/^element/, "Return the SMART response as a JSON string in element smart_health_checkin_response."],
    [/^json/, "The element value must be valid JSON."],
    [/^shape/, "Follow the response model in §6.1: type, version \"1\", requestId, artifacts, requestStatus."],
    [/^request-id/, "Copy the request's id into the response's requestId."],
    [/^status-extra/, "Only send status rows for items in the request."],
    [/^status-/, "Send exactly one requestStatus row for every item in the request, with one of the six status codes."],
    [/^artifact-/, "Fix the record as described; until then the EHR sets it aside and uses the rest."],
    [/^form-/, "Answer a form item with a QuestionnaireResponse."],
    [/^fulfilled-/, "A fulfilled or partial item needs a usable record that lists it in fulfills."],
    [/^versioned-/, "For a versioned profile, return resources whose meta.profile includes that exact versioned canonical, or report partial."],
    [/^shc-/, "Sign the card with a key published at the issuer's /.well-known/jwks.json, with header alg ES256, zip DEF, and kid."],
  ];
  return FIX.find(([re]) => re.test(id))?.[1] ?? "";
}
