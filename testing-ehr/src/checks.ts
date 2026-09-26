// Response checks for the testing EHR. Each check reports pass, fail, warn, or
// info, with the spec section it comes from. Nothing here throws: a malformed
// response produces failed checks, not an exception.
import {
  type SmartCheckinRequest,
} from "@smart-health-checkin/client";
import { buildDcapiSessionTranscript } from "@smart-health-checkin/client/wire";
import { validateResponseAgainstRequest, validateSmartCheckinResponse } from "@smart-health-checkin/client/model";
import { openWalletResponse, verifyDeviceResponseSignatures } from "@smart-health-checkin/client/wire";

export type Outcome = "pass" | "fail" | "warn" | "info";
export type Check = { id: string; title: string; outcome: Outcome; detail: string; section?: string };

const SPEC = "https://smart-health-checkin.org/spec/#";

export type RunInput = {
  request: SmartCheckinRequest;
  credential: unknown;
  verifierKeyPair: CryptoKeyPair;
  verifierPublicJwk: JsonWebKey;
  encryptionInfoBytes: Uint8Array;
  origin: string;
};

/** The layers under the SMART response, for the wire view. */
export type WireLayers = {
  encBytes?: number;
  cipherTextBytes?: number;
  deviceResponseBytes?: number;
  deviceResponseDiagnostic?: string;
  msoDiagnostic?: string;
  digestAlgorithm?: string;
};

export type RunResult = { checks: Check[]; smartResponse?: any; responseBytes?: number; wire?: WireLayers };

export async function checkResponse(input: RunInput): Promise<RunResult> {
  const checks: Check[] = [];
  const add = (id: string, title: string, outcome: Outcome, detail: string, section?: string) =>
    checks.push({ id, title, outcome, detail, section: section ? SPEC + section : undefined });
  const wire: WireLayers = {};
  const done = (extra: Partial<RunResult> = {}): RunResult => ({ checks, wire, ...extra });

  // 1. Wrapper
  const cred = input.credential as { protocol?: string; data?: { response?: unknown } } | undefined;
  if (cred?.protocol !== "org-iso-mdoc") {
    add("protocol", "Returned protocol is org-iso-mdoc", "fail", `got ${JSON.stringify(cred?.protocol)}`, "8-5-hpke-encryption-and-verifier-processing");
    return done();
  }
  add("protocol", "Returned protocol is org-iso-mdoc", "pass", "", "8-5-hpke-encryption-and-verifier-processing");
  const response = cred.data?.response;
  if (typeof response !== "string" || !/^[A-Za-z0-9_-]+$/.test(response)) {
    add("wrapper", "data.response is unpadded base64url", "fail", typeof response === "string" ? "contains characters outside base64url, or padding" : `got ${typeof response}`, "a-2-digital-credentials-api-wrappers");
    return done();
  }
  add("wrapper", "data.response is unpadded base64url", "pass", `${response.length} characters`, "a-2-digital-credentials-api-wrappers");

  // 2. HPKE with the transcript bound to this page's origin
  const sessionTranscript = await buildDcapiSessionTranscript({ origin: input.origin, encryptionInfo: input.encryptionInfoBytes });
  let opened: Awaited<ReturnType<typeof openWalletResponse>>;
  try {
    opened = await openWalletResponse({
      response,
      recipientPrivateKey: input.verifierKeyPair.privateKey,
      recipientPublicJwk: input.verifierPublicJwk,
      sessionTranscript,
    });
    add("hpke", "Response decrypts with this page's key and origin", "pass", `${opened.deviceResponseBytes.length} bytes of DeviceResponse`, "8-5-hpke-encryption-and-verifier-processing");
    const hexBytes = (h?: string) => (h ? h.length / 2 : undefined);
    wire.encBytes = hexBytes(opened.dcapiResponse.enc?.hex);
    wire.cipherTextBytes = hexBytes(opened.dcapiResponse.cipherText?.hex);
    wire.deviceResponseBytes = opened.deviceResponseBytes.length;
    wire.deviceResponseDiagnostic = opened.deviceResponse.deviceResponseDiagnostic;
    const firstDoc = opened.deviceResponse.documents[0];
    wire.msoDiagnostic = firstDoc?.issuerAuth?.msoDiagnostic;
    wire.digestAlgorithm = firstDoc?.issuerAuth?.digestAlgorithm;
  } catch (e) {
    add("hpke", "Response decrypts with this page's key and origin", "fail",
      `${(e as Error).message}. Usual causes: the wallet bound the transcript to a different origin, used different encryptionInfo, or the ciphertext is damaged.`,
      "8-3-sessiontranscript");
    return done({ responseBytes: response.length });
  }

  // 3. DeviceResponse structure and signatures
  const dr = opened.deviceResponse;
  add("dr-version", "DeviceResponse version is 1.0", dr.version === "1.0" ? "pass" : "fail", `version ${dr.version ?? "(none)"}`, "8-4-wallet-request-handling-and-response-construction");
  add("dr-status", "DeviceResponse status is 0 (OK)", dr.status === 0 ? "pass" : "fail", `status ${dr.status ?? "(none)"}`, "8-4-wallet-request-handling-and-response-construction");
  const doc = dr.documents[0];
  add("doctype", "Document docType is org.smarthealthit.checkin.1", doc?.docType === "org.smarthealthit.checkin.1" ? "pass" : "fail", `docType ${doc?.docType ?? "(no document)"}`, "8-1-identifiers-and-constants");
  try {
    const [v] = await verifyDeviceResponseSignatures({ deviceResponseBytes: opened.deviceResponseBytes, sessionTranscript });
    if (!v) {
      add("issuer-sig", "Issuer signature (issuerAuth) verifies", "fail", "no document to verify", "8-6-validation-checklist");
    } else {
      add("issuer-sig", "Issuer signature (issuerAuth) verifies", v.issuerAuth.signatureValid ? "pass" : "fail", v.issuerAuth.error ?? (v.issuerAuth.present ? "" : "issuerAuth missing"), "8-6-validation-checklist");
      add("device-sig", "Device signature verifies over this session", v.deviceSignature.signatureValid ? "pass" : "fail", v.deviceSignature.error ?? (v.deviceSignature.present ? "" : "device signature missing"), "8-6-validation-checklist");
      add("digests", "Value digests match the MSO", v.digests.checked > 0 && v.digests.matched === v.digests.checked ? "pass" : "fail", `${v.digests.matched} of ${v.digests.checked} matched`, "8-4-wallet-request-handling-and-response-construction");
    }
  } catch (e) {
    add("issuer-sig", "Issuer and device signatures verify", "fail", (e as Error).message, "8-6-validation-checklist");
  }

  // 4. SMART response
  const element = doc?.elements.find((x) => x.namespace === "org.smarthealthit.checkin" && x.elementIdentifier === "smart_health_checkin_response");
  if (!element || typeof element.elementValue !== "string") {
    add("element", "smart_health_checkin_response element is a JSON string", "fail", element ? `elementValue is ${typeof element.elementValue}` : "element not found", "8-1-identifiers-and-constants");
    return done({ responseBytes: response.length });
  }
  add("element", "smart_health_checkin_response element is a JSON string", "pass", `${element.elementValue.length} characters`, "8-1-identifiers-and-constants");
  let smart: any;
  try {
    smart = JSON.parse(element.elementValue);
  } catch (e) {
    add("json", "Response element parses as JSON", "fail", (e as Error).message, "6-1-normative-typescript-model");
    return done({ responseBytes: response.length });
  }
  const shape = validateSmartCheckinResponse(smart);
  add("shape", "SMART response is well formed", shape.ok ? "pass" : "fail", shape.ok ? "" : shape.error, "6-1-normative-typescript-model");
  add("request-id", "requestId echoes the request id", smart.requestId === input.request.id ? "pass" : "fail", `sent ${input.request.id}, got ${smart.requestId}`, "6-1-normative-typescript-model");

  const statuses: any[] = Array.isArray(smart.requestStatus) ? smart.requestStatus : [];
  const counts = new Map<string, number>();
  for (const s of statuses) counts.set(s.item, (counts.get(s.item) ?? 0) + 1);
  const statusProblems = input.request.items.filter((i) => counts.get(i.id) !== 1).map((i) => `${i.id}: ${counts.get(i.id) ?? 0} statuses`);
  const extra = [...counts.keys()].filter((k) => !input.request.items.some((i) => i.id === k));
  add("one-status", "Exactly one status per requested item", statusProblems.length || extra.length ? "fail" : "pass",
    [...statusProblems, ...extra.map((k) => `${k}: not a requested item`)].join("; ") || statuses.map((s) => `${s.item}=${s.status}`).join(", "), "6-2-artifact-and-status-semantics");

  const cross = validateResponseAgainstRequest(input.request, smart);
  add("cross", "Response is consistent with the request", cross.ok ? "pass" : "fail", cross.ok ? "" : cross.error, "6-4-verifier-cross-validation");

  // 5. Per-artifact checks
  const artifacts: any[] = Array.isArray(smart.artifacts) ? smart.artifacts : [];
  const itemById = new Map(input.request.items.map((i) => [i.id, i]));
  const mediaProblems: string[] = [];
  for (const a of artifacts) for (const f of a.fulfills ?? []) {
    const item = itemById.get(f);
    if (item && !item.accept.includes(a.mediaType)) mediaProblems.push(`${a.id} is ${a.mediaType}, but ${f} accepts ${item.accept.join(", ")}`);
  }
  add("media", "Every artifact's media type is accepted by the items it fulfills", mediaProblems.length ? "fail" : "pass", mediaProblems.join("; "), "5-6-accepted-media-types");

  for (const item of input.request.items) {
    const status = statuses.find((s) => s.item === item.id)?.status;
    const mine = artifacts.filter((a) => (a.fulfills ?? []).includes(item.id));
    if ((status === "fulfilled" || status === "partial") && !mine.length)
      add(`artifact-${item.id}`, `${item.id}: a ${status} item has an artifact`, "warn", "no artifact lists this item in fulfills", "6-2-artifact-and-status-semantics");
    const content: any = item.content;
    if (content.kind === "form.fhir") {
      for (const a of mine.filter((x) => x.mediaType === "application/fhir+json")) {
        const qr = a.value;
        if (qr?.resourceType !== "QuestionnaireResponse") {
          add(`qr-${item.id}`, `${item.id}: form answered with a QuestionnaireResponse`, "fail", `got ${qr?.resourceType}`, "5-6-accepted-media-types");
          continue;
        }
        const want = content.questionnaireCanonical;
        if (want) add(`canonical-${item.id}`, `${item.id}: QuestionnaireResponse.questionnaire echoes the canonical exactly`, qr.questionnaire === want ? "pass" : "fail", `requested ${want}, got ${qr.questionnaire}`, "5-5-canonical-version-handling");
        const answered = countAnswers(qr.item);
        add(`answers-${item.id}`, `${item.id}: answers returned`, answered ? "info" : "warn", `${answered} answered item(s)`, "5-4-2-form-fhir");
      }
    }
    if (content.kind === "selection.fhir" && (content.profiles?.length || content.profilesFrom?.length)) {
      for (const a of mine.filter((x) => x.mediaType === "application/fhir+json")) {
        const resources = bundleResources(a.value);
        const primary = resources.filter((r) => !content.resourceTypes || content.resourceTypes.includes(r.resourceType));
        const matching = primary.filter((r) => (r.meta?.profile ?? []).some((p: string) =>
          (content.profiles ?? []).some((w: string) => p.split("|")[0] === w.split("|")[0] && (!w.includes("|") || p === w)) ||
          (content.profilesFrom ?? []).some((f: string) => p.startsWith(f.replace(/\/+$/, "") + "/StructureDefinition/"))));
        add(`profile-${item.id}`, `${item.id}: returned resources claim a requested profile`, matching.length ? "pass" : "warn",
          `${matching.length} of ${resources.length} resource(s) declare a requested profile in meta.profile`, "5-4-1-selection-fhir");
      }
    }
    for (const a of mine.filter((x) => x.mediaType === "application/smart-health-card")) {
      for (const [n, jws] of (a.value?.verifiableCredential ?? []).entries()) {
        const r = await verifyHealthCard(jws);
        add(`shc-${a.id}-${n}`, `${a.id}: SMART Health Card signature verifies`, r.ok ? "pass" : "fail", r.detail, "5-6-accepted-media-types");
      }
    }
  }

  const size = response.length;
  add("size", "Response size", size > 512 * 1024 ? "warn" : "info", `${(size / 1024).toFixed(1)} KB base64url${size > 512 * 1024 ? "; over 512 KB, which some Android wallet APIs cannot carry" : ""}`);
  return done({ smartResponse: smart, responseBytes: size });
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
export function groupOf(id: string): "Wire" | "SMART response" | "Items" | "Info" {
  if (/^(protocol|wrapper|hpke|dr-|doctype|issuer-sig|device-sig|digests)/.test(id)) return "Wire";
  if (/^(element|json|shape|request-id|one-status|cross|media)/.test(id)) return "SMART response";
  if (id === "size") return "Info";
  return "Items";
}

/** What a wallet builder should do when a check fails. */
export function fixFor(id: string): string {
  const FIX: Array<[RegExp, string]> = [
    [/^protocol/, "Return the credential with protocol \"org-iso-mdoc\"."],
    [/^wrapper/, "Put the HPKE-sealed response in data.response as unpadded base64url."],
    [/^hpke/, "Encrypt to the recipient key in this request's encryptionInfo, and build the SessionTranscript from that exact encryptionInfo and the EHR page's origin (from the browser, never the message)."],
    [/^dr-version/, "Set DeviceResponse.version to \"1.0\"."],
    [/^dr-status/, "Set DeviceResponse.status to 0."],
    [/^doctype/, "Use docType \"org.smarthealthit.checkin.1\"."],
    [/^issuer-sig/, "Sign the MSO with issuerAuth (COSE_Sign1, ES256) over the exact tag-24 MSO bytes."],
    [/^device-sig/, "Sign DeviceAuthentication over this request's SessionTranscript with the device key in the MSO."],
    [/^digests/, "Compute each value digest over the exact tag-24 IssuerSignedItem bytes you send."],
    [/^element/, "Return the SMART response as a JSON string in element smart_health_checkin_response."],
    [/^json/, "The element value must be valid JSON."],
    [/^shape/, "Follow the response model in §6.1: type, version, requestId, artifacts, requestStatus."],
    [/^request-id/, "Copy the request's id into the response's requestId."],
    [/^one-status/, "Add exactly one requestStatus entry for every item in the request, and none for items it didn't ask for."],
    [/^cross/, "Every artifact must fulfill requested items, and each status must agree with the artifacts sent."],
    [/^media/, "Send each item's data only in a media type listed in that item's accept."],
    [/^artifact-/, "A fulfilled or partial item needs an artifact that lists it in fulfills."],
    [/^qr-/, "Answer a form item with a QuestionnaireResponse."],
    [/^canonical-/, "Copy questionnaireCanonical from the request into QuestionnaireResponse.questionnaire exactly, including any |version."],
    [/^answers-/, "Include the patient's answers in QuestionnaireResponse.item."],
    [/^profile-/, "Return resources whose meta.profile names a requested profile (or one in a requested family)."],
    [/^shc-/, "Sign the card with a key published at the issuer's /.well-known/jwks.json, with header alg ES256, zip DEF, and kid."],
  ];
  return FIX.find(([re]) => re.test(id))?.[1] ?? "";
}
