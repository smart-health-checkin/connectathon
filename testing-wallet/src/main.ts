// SMART reference web wallet. See ../FEATURES.md for the behavior this implements.
import {
  type SmartArtifact,
  type SmartCheckinItemStatus,
  type SmartCheckinRequest,
  type SmartCheckinRequestItem,
  type SmartCheckinResponse,
} from "@smart-health-checkin/client";
import { declineAll, selectEntries, serveWebWallet, type SelectionContent, type WebWalletAnswer } from "@smart-health-checkin/client/wallet";
import { cborDecode, mapGet } from "@smart-health-checkin/client/wire";
import { describeEntries, type Entry } from "./match.ts";
import { buildQuestionnaireResponse, prefill, renderForm, resolveQuestionnaire, type FormState, type Questionnaire } from "./forms.ts";
import { mintHealthCard } from "./shc.ts";
import { seal } from "./seal.ts";
import { earlierRecords, formatSize, pickArtifact, RESPONSE_SIZES } from "./size.ts";
import { renderJson } from "../../shared/smart-json.ts";

const STATUSES = ["fulfilled", "partial", "unavailable", "declined", "unsupported", "error"] as const;
const FAULTS: Record<string, string> = {
  "wrong-canonical": "QuestionnaireResponse.questionnaire doesn't match the request",
  "missing-status": "Leave one item without a status",
  "duplicate-status": "Give one item two statuses",
  "wrong-request-id": "requestId doesn't match",
  "unaccepted-media-type": "Return an artifact in a media type the item didn't accept",
  "bad-signature": "Corrupt the issuer signature",
  "bad-encryption": "Corrupt the HPKE ciphertext",
  "wrong-origin": "Bind the transcript to the origin with a trailing slash",
  "bad-shc-signature": "Break the SMART Health Card signature",
  "combine-allergies-meds": "Answer allergies and medications with one shared Bundle (O7)",
};
/** How an EHR that follows the spec reacts to each fault (§6.4, §8.5). */
const FAULT_EFFECT: Record<string, string> = {
  "wrong-canonical": "the EHR sets that record aside",
  "missing-status": "the EHR treats that item as unknown",
  "duplicate-status": "the EHR treats that item as unknown",
  "wrong-request-id": "the EHR rejects the response",
  "unaccepted-media-type": "the EHR sets that record aside",
  "bad-signature": "the EHR warns and continues",
  "bad-encryption": "the EHR rejects the response",
  "wrong-origin": "the EHR rejects the response",
  "bad-shc-signature": "the EHR sets that card aside",
  "combine-allergies-meds": "passes",
};
/** Media types this wallet can produce. */
const PRODUCIBLE = ["application/fhir+json", "application/smart-health-card"];
const PATIENTS: Record<string, { label: string; file: string }> = {
  aria: { label: "Aria Test", file: "data/aria-test.json" },
  large: { label: "Aria Test, large record", file: "data/large-record.json" },
};

// ---------------------------------------------------------------- settings in the URL fragment
function readSettings() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    patient: PATIENTS[p.get("patient") ?? ""] ? p.get("patient")! : "aria",
    faults: new Set((p.get("faults") ?? "").split(",").filter((f) => FAULTS[f])),
    status: new Map((p.get("status") ?? "").split(",").filter(Boolean).map((kv) => kv.split(":") as [string, string])),
    size: RESPONSE_SIZES[p.get("size") ?? ""] ? p.get("size")! : "",
    testing: p.get("testing") === "1" || p.has("faults") || p.has("status") || p.has("size"),
  };
}
const settings = readSettings();
function writeSettings() {
  const p = new URLSearchParams();
  if (settings.patient !== "aria") p.set("patient", settings.patient);
  if (settings.faults.size) p.set("faults", [...settings.faults].join(","));
  if (settings.status.size) p.set("status", [...settings.status].map(([k, v]) => `${k}:${v}`).join(","));
  if (settings.size) p.set("size", settings.size);
  if (settings.testing) p.set("testing", "1");
  history.replaceState(null, "", `${location.pathname}${location.search}${p.size ? "#" + p : ""}`);
}

// ---------------------------------------------------------------- DOM helpers
const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}

// ---------------------------------------------------------------- patient data
const patientCache = new Map<string, Promise<Entry[]>>();
function loadPatient(key: string): Promise<Entry[]> {
  if (!patientCache.has(key)) {
    patientCache.set(key, fetch(new URL(PATIENTS[key]!.file, location.href)).then(async (r) => {
      if (!r.ok) throw new Error(`could not load ${PATIENTS[key]!.file}: HTTP ${r.status}`);
      return ((await r.json()) as { entry: Entry[] }).entry;
    }));
  }
  return patientCache.get(key)!;
}

// ---------------------------------------------------------------- request parsing
type Session = {
  ehrOrigin: string;
  /** Resolves the answer serveWebWallet sends back to the EHR. */
  answer: (a: WebWalletAnswer) => void;
  request: SmartCheckinRequest;
  encryptionInfoBytes: Uint8Array;
  readerAuth: "absent" | "present";
  unknownKinds: Set<string>;
  /** Items the library couldn't process (bad selector members, a malformed form), with why. */
  unsupported: Map<string, string>;
};
let session: Session | undefined;

/**
 * The library's serveWebWallet has already parsed and validated the request
 * (extension selector kinds are allowed through). Note which items use a kind
 * this wallet doesn't know, so they're answered "unsupported" while the rest
 * of the request is still served (§5.4.3), and whether readerAuth was sent.
 */
function describeRequest(request: SmartCheckinRequest, deviceRequestBytes: Uint8Array): Omit<Session, "ehrOrigin" | "answer" | "encryptionInfoBytes" | "request" | "unsupported"> {
  const unknownKinds = new Set<string>(
    request.items.filter((i) => !["selection.fhir", "form.fhir"].includes(i.content.kind)).map((i) => i.id),
  );
  const docRequests = mapGet(cborDecode(deviceRequestBytes), "docRequests");
  const readerAuth = Array.isArray(docRequests) && mapGet(docRequests[0], "readerAuth") !== undefined ? "present" : "absent";
  return { readerAuth, unknownKinds };
}

// ---------------------------------------------------------------- per-item preparation
type Prepared =
  | { kind: "selection"; item: SmartCheckinRequestItem; entries: Entry[]; share: boolean }
  | { kind: "form"; item: SmartCheckinRequestItem; state: FormState; share: boolean }
  | { kind: "unsupported"; item: SmartCheckinRequestItem; reason: string; share: false };
let prepared: Prepared[] = [];

async function prepare(s: Session): Promise<Prepared[]> {
  const entries = await loadPatient(settings.patient);
  const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
  const observations = entries.filter((e) => e.resource.resourceType === "Observation").map((e) => e.resource as any);
  return Promise.all(
    s.request.items.map(async (item): Promise<Prepared> => {
      if (s.unsupported.has(item.id)) return { kind: "unsupported", item, reason: s.unsupported.get(item.id)!, share: false };
      if (s.unknownKinds.has(item.id)) return { kind: "unsupported", item, reason: `selector kind "${(item.content as any).kind}" is not supported`, share: false };
      // [ACC-2] Only media types the item accepts; a form is always a QuestionnaireResponse in FHIR JSON.
      const producible = item.content.kind === "form.fhir" ? ["application/fhir+json"] : PRODUCIBLE;
      if (!item.accept.some((m) => producible.includes(m))) return { kind: "unsupported", item, reason: `it accepts only ${item.accept.join(", ")}`, share: false };
      if (item.content.kind === "selection.fhir") {
        const picked = selectEntries(item.content as SelectionContent, entries, { exclude: [patient.fullUrl] }) as Entry[];
        return { kind: "selection", item, entries: picked, share: true };
      }
      try {
        const questionnaire = await resolveQuestionnaire(item.content as { questionnaire?: Questionnaire; questionnaireCanonical?: string });
        const state: FormState = { questionnaire, answers: new Map(), prefilled: new Set() };
        prefill(state, observations);
        return { kind: "form", item, state, share: true };
      } catch (e) {
        return { kind: "unsupported", item, reason: (e as Error).message, share: false };
      }
    }),
  );
}

// ---------------------------------------------------------------- response
async function buildResponse(s: Session, items: Prepared[]): Promise<SmartCheckinResponse> {
  const entries = await loadPatient(settings.patient);
  const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
  const artifacts: SmartArtifact[] = [];
  const statuses: SmartCheckinItemStatus[] = [];
  const bundle = (es: Entry[]) => ({ resourceType: "Bundle", type: "collection", entry: es.map((e) => ({ fullUrl: e.fullUrl, resource: e.resource })) });
  const combine = settings.faults.has("combine-allergies-meds");
  let combined: { entries: Entry[]; fulfills: string[] } | undefined;

  for (const p of items) {
    const forced = settings.status.get(p.item.id);
    if (p.kind === "unsupported") {
      statuses.push({ item: p.item.id, status: "unsupported", message: p.reason });
      continue;
    }
    if (!p.share) {
      statuses.push({ item: p.item.id, status: "declined" });
      continue;
    }
    if (forced && forced !== "fulfilled" && forced !== "partial") {
      statuses.push({ item: p.item.id, status: forced as SmartCheckinItemStatus["status"], message: "set on the testing panel" });
      continue;
    }
    if (p.kind === "form") {
      const canonical = (p.item.content as any).questionnaireCanonical as string | undefined;
      const qr = buildQuestionnaireResponse(p.state, settings.faults.has("wrong-canonical") && canonical ? canonical.split("|")[0] + "-wrong" : canonical, patient.fullUrl);
      artifacts.push({ id: `qr-${p.item.id}`, mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [p.item.id], value: qr });
      statuses.push({ item: p.item.id, status: (forced as any) ?? "fulfilled" });
      continue;
    }
    if (!p.entries.length) {
      statuses.push({ item: p.item.id, status: "unavailable", message: "nothing in this record matches" });
      continue;
    }
    if (combine && /allerg|medication/.test(p.item.id)) {
      combined ??= { entries: [], fulfills: [] };
      for (const e of p.entries) if (!combined.entries.some((x) => x.fullUrl === e.fullUrl)) combined.entries.push(e);
      combined.fulfills.push(p.item.id);
      statuses.push({ item: p.item.id, status: (forced as any) ?? "fulfilled" });
      continue;
    }
    const accept = p.item.accept;
    // [ACC-3] The earliest accepted type this wallet can produce.
    const wantsCard = accept.find((m) => PRODUCIBLE.includes(m)) === "application/smart-health-card";
    if (settings.faults.has("unaccepted-media-type")) {
      const other = accept.includes("application/fhir+json") ? "application/smart-health-card" : "application/fhir+json";
      artifacts.push(other === "application/smart-health-card"
        ? { id: `card-${p.item.id}`, mediaType: "application/smart-health-card", fulfills: [p.item.id], value: { verifiableCredential: [await mintHealthCard(p.entries)] } }
        : { id: `fhir-${p.item.id}`, mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [p.item.id], value: bundle(p.entries) });
    } else if (wantsCard) {
      const card = await mintHealthCard(p.entries, { breakSignature: settings.faults.has("bad-shc-signature") });
      artifacts.push({ id: `card-${p.item.id}`, mediaType: "application/smart-health-card", fulfills: [p.item.id], value: { verifiableCredential: [card] } });
    } else {
      artifacts.push({ id: `fhir-${p.item.id}`, mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [p.item.id], value: bundle(p.entries) });
    }
    statuses.push({ item: p.item.id, status: (forced as any) ?? "fulfilled" });
  }
  if (combined) artifacts.push({ id: "fhir-combined", mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: combined.fulfills, value: bundle(combined.entries) });

  if (settings.faults.has("missing-status") && statuses.length) statuses.pop();
  if (settings.faults.has("duplicate-status") && statuses.length) statuses.push({ ...statuses[0]! });
  return {
    type: "smart-health-checkin-response",
    version: "1",
    requestId: settings.faults.has("wrong-request-id") ? `${s.request.id}-wrong` : s.request.id,
    artifacts,
    requestStatus: statuses,
  };
}

type Sealed = {
  credential: { protocol: string; data: { response: string } };
  /** The response as sent, with any records the size setting added summarized, for display. */
  shown: SmartCheckinResponse;
  /** Characters of base64url in `data.response`: what the EHR receives. */
  chars: number;
  /** What the size setting did, in a sentence. */
  sizeNote?: string;
};

/**
 * Build and seal the response. With a response size set on the testing
 * panel, one requested item's Bundle gets earlier records of the same kinds
 * until the encoded response reaches about that size (./size.ts).
 */
async function buildAndSeal(s: Session, items: Prepared[]): Promise<Sealed> {
  const smartResponse = await buildResponse(s, items);
  const sealIt = () => seal({ smartResponse, encryptionInfoBytes: s.encryptionInfoBytes, ehrOrigin: s.ehrOrigin, faults: settings.faults });
  let credential = await sealIt();
  const target = RESPONSE_SIZES[settings.size];
  if (!target) return { credential, shown: smartResponse, chars: credential.data.response.length };
  const artifact = pickArtifact(smartResponse);
  if (!artifact) {
    return { credential, shown: smartResponse, chars: credential.data.response.length,
      sizeNote: `The ${target.label} setting needs a shared item answered with a FHIR Bundle of records, such as labs, medications, or immunizations. This response has none, so it goes at its normal size.` };
  }
  const before = credential.data.response.length;
  // base64url carries 3 bytes in 4 characters, and the JSON rides in the mdoc as UTF-8 bytes.
  const added = before < target.chars ? earlierRecords(artifact.value, Math.floor(((target.chars - before) * 3) / 4)) : [];
  const original = artifact.value.entry;
  artifact.value.entry = [...original, ...added];
  if (added.length) credential = await sealIt();
  const counts = new Map<string, number>();
  for (const e of added) counts.set(e.resource.resourceType, (counts.get(e.resource.resourceType) ?? 0) + 1);
  const kinds = [...counts].map(([t, n]) => `${n.toLocaleString("en-US")} earlier ${t} records`).join(", ");
  const titles = artifact.fulfills.map((id) => items.find((p) => p.item.id === id)?.item.title ?? id).join(" and ");
  const shown = {
    ...smartResponse,
    artifacts: smartResponse.artifacts.map((a) => a !== artifact ? a : { ...a, value: { ...artifact.value, entry: [...original, `… and ${added.length.toLocaleString("en-US")} earlier records added for the response size setting`] } }),
  } as SmartCheckinResponse;
  return { credential, shown, chars: credential.data.response.length,
    sizeNote: added.length ? `The ${target.label} setting added ${kinds} to ${titles}.` : undefined };
}

function reply(s: Session, message: { outcome: "approved"; credential: { protocol: string; data: { response: string } } } | { outcome: "declined" } | { outcome: "error"; message: string }) {
  if (message.outcome === "approved") s.answer({ credential: message.credential });
  else if (message.outcome === "declined") s.answer({ declined: true });
  else s.answer({ error: message.message });
}

// ---------------------------------------------------------------- rendering
function renderPatientPicker(onChange: () => void) {
  const select = $("patient") as HTMLSelectElement;
  select.replaceChildren(...Object.entries(PATIENTS).map(([k, p]) => el("option", { value: k, selected: k === settings.patient }, p.label)));
  select.onchange = () => {
    settings.patient = select.value;
    writeSettings();
    onChange();
  };
}

function renderTestingPanel() {
  const panel = $("testing") as HTMLDetailsElement;
  panel.open = settings.testing;
  panel.ontoggle = () => {
    settings.testing = panel.open;
    writeSettings();
  };
  const faults = $("faults");
  faults.replaceChildren(
    ...Object.entries(FAULTS).map(([k, text]) => {
      const input = el("input", { type: "checkbox", id: `fault-${k}`, checked: settings.faults.has(k) });
      input.onchange = () => {
        input.checked ? settings.faults.add(k) : settings.faults.delete(k);
        writeSettings();
      };
      return el("label", { htmlFor: `fault-${k}`, className: "fault" }, input, " ", el("code", {}, k), " ", text, el("small", {}, ` (${FAULT_EFFECT[k] ?? ""})`));
    }),
  );
}

function renderSizeDial(onChange: () => void) {
  const host = $("response-size");
  const options: [string, string][] = [["", "Normal"], ...Object.entries(RESPONSE_SIZES).map(([k, v]) => [k, v.label] as [string, string])];
  const buttons = options.map(([key, label]) => {
    const b = el("button", { type: "button", id: `size-${key || "normal"}` }, label);
    b.setAttribute("aria-pressed", String(settings.size === key));
    b.onclick = () => {
      settings.size = key;
      for (const x of buttons) x.setAttribute("aria-pressed", String(x === b));
      writeSettings();
      onChange();
    };
    return b;
  });
  host.replaceChildren(...buttons);
}

function renderStatusOverrides(items: Prepared[]) {
  const host = $("status-overrides");
  host.replaceChildren(
    ...items.map((p) => {
      const select = el("select", { id: `status-${p.item.id}` });
      select.append(el("option", { value: "" }, "(normal)"), ...STATUSES.map((s) => el("option", { value: s, selected: settings.status.get(p.item.id) === s }, s)));
      select.onchange = () => {
        select.value ? settings.status.set(p.item.id, select.value) : settings.status.delete(p.item.id);
        writeSettings();
      };
      return el("label", { htmlFor: select.id, className: "override" }, el("code", {}, p.item.id), " ", select);
    }),
  );
}

function renderItems(items: Prepared[]) {
  const list = $("items");
  list.replaceChildren(
    ...items.map((p, idx) => {
      const card = el("li", { className: `item item-${p.kind}` });
      const toggle = el("input", { type: "checkbox", id: `share-${idx}`, checked: p.share, disabled: p.kind === "unsupported" });
      toggle.onchange = () => {
        (p as { share: boolean }).share = toggle.checked;
        card.classList.toggle("off", !toggle.checked);
      };
      const head = el("label", { htmlFor: toggle.id, className: "item-head" }, toggle, " ", el("b", {}, p.item.title));
      card.append(head);
      if (p.item.summary) card.append(el("p", { className: "summary" }, p.item.summary));
      if (p.item.required) card.append(el("p", { className: "required" }, "The clinic says this is required. You can still choose not to share it."));
      if (p.kind === "selection") {
        const what = p.entries.length ? `Will share ${describeEntries(p.entries)}` : "Nothing in this record matches, so this will be reported as unavailable.";
        card.append(el("p", { className: "preview" }, what));
      } else if (p.kind === "form") {
        const host = el("div", { className: "form" });
        card.append(el("p", { className: "preview" }, p.state.questionnaire.title ?? "A form from the clinic"), host);
        renderForm(host, p.state, `f${idx}`);
      } else {
        card.append(el("p", { className: "preview warn" }, `This wallet can't answer this item: ${p.reason}. It will be reported as unsupported.`));
      }
      return card;
    }),
  );
}

async function showRequest(s: Session) {
  const shareButton = $("share") as HTMLButtonElement;
  const declineButton = $("decline") as HTMLButtonElement;
  // Disabled until the items are ready, so an early click can't be lost.
  shareButton.disabled = declineButton.disabled = true;
  $("waiting").hidden = true;
  $("consent").hidden = false;
  $("origin").textContent = s.ehrOrigin;
  $("purpose").textContent = s.request.purpose ?? "";
  renderJson($("raw-request"), s.request);
  const redraw = async () => {
    shareButton.disabled = true;
    prepared = await prepare(s);
    renderItems(prepared);
    renderStatusOverrides(prepared);
    shareButton.disabled = declineButton.disabled = false;
    measure();
  };
  // The size line on the approval screen: build and seal what Share would send.
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const measure = () => {
    clearTimeout(timer);
    const mine = ++generation;
    const line = $("size-line");
    line.dataset.state = "measuring";
    line.textContent = settings.size ? `Response size: building a ${RESPONSE_SIZES[settings.size]!.label} response…` : "Response size: measuring…";
    timer = setTimeout(async () => {
      try {
        const sealed = await buildAndSeal(s, prepared);
        if (mine !== generation) return;
        line.textContent = `Response size: ${formatSize(sealed.chars)} (${sealed.chars.toLocaleString("en-US")} characters of base64url).${sealed.sizeNote ? ` ${sealed.sizeNote}` : ""}`;
        line.dataset.state = "ready";
        line.dataset.chars = String(sealed.chars);
      } catch (e) {
        if (mine !== generation) return;
        line.textContent = `Response size: could not build the response: ${(e as Error).message}`;
        line.dataset.state = "error";
      }
    }, 150);
  };
  renderSizeDial(measure);
  $("consent").onchange = measure;
  $("testing").onchange = measure;
  renderPatientPicker(() => void redraw());
  await redraw();
  ($("share") as HTMLButtonElement).onclick = async () => {
    const button = $("share") as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Sharing…";
    try {
      const { credential, shown, chars } = await buildAndSeal(s, prepared);
      renderJson($("raw-response"), shown);
      reply(s, { outcome: "approved", credential });
      $("consent").hidden = true;
      $("done").hidden = false;
      $("done-text").textContent = `Sent ${formatSize(chars)}${settings.faults.size ? `, with faults: ${[...settings.faults].join(", ")}.` : ". You can close this tab."}`;
      setShareLink("shared");
      if (!settings.testing) setTimeout(() => window.close(), 800);
    } catch (e) {
      showError(`Could not build the response: ${(e as Error).message}`);
      reply(s, { outcome: "error", message: (e as Error).message });
      button.disabled = false;
      button.textContent = "Share";
    }
  };
  // [HOLD-4] The patient reviewed the request and declined everything: answer
  // with every item declined. (Closing the tab without answering is the
  // cancel path; the EHR's call then fails.)
  ($("decline") as HTMLButtonElement).onclick = async () => {
    const button = $("decline") as HTMLButtonElement;
    button.disabled = true;
    try {
      const smartResponse = declineAll(s.request);
      renderJson($("raw-response"), smartResponse);
      const credential = await seal({ smartResponse, encryptionInfoBytes: s.encryptionInfoBytes, ehrOrigin: s.ehrOrigin, faults: new Set() });
      reply(s, { outcome: "approved", credential });
      $("consent").hidden = true;
      $("done").hidden = false;
      $("done-text").textContent = "Declined every item; the clinic was told. You can close this tab.";
      setShareLink("declined");
      if (!settings.testing) setTimeout(() => window.close(), 800);
    } catch (e) {
      showError(`Could not build the response: ${(e as Error).message}`);
      reply(s, { outcome: "error", message: (e as Error).message });
    }
  };
}

function showError(message: string) {
  const box = $("error");
  box.hidden = false;
  box.textContent = message;
}

// ---------------------------------------------------------------- hand-off
// The library does the protocol: one request from the opener, the EHR's origin
// from the browser, the reply to that origin. This wallet seals its own
// responses (so it can inject wire faults) and closes its own tab.
const served = serveWebWallet({
  closeAfterReply: false,
  onRequest: ({ request, origin, parsed, unsupportedItems }) =>
    new Promise<WebWalletAnswer>((answer) => {
      const unsupported = new Map(unsupportedItems.map((u) => [u.id, u.message] as [string, string]));
      session = { ehrOrigin: origin, answer, request, encryptionInfoBytes: parsed.encryptionInfoBytes, unsupported, ...describeRequest(request, parsed.deviceRequestBytes) };
      void showRequest(session).catch((e) => showError((e as Error).message));
    }),
  onInvalidRequest: (message, origin) => {
    $("waiting").hidden = true;
    showError(`Could not read the request from ${origin}: ${message}`);
  },
});

renderTestingPanel();
if (!served.opened) {
  $("waiting").hidden = true;
  $("standalone").hidden = false;
}

/** Point "Tell us how it went" at the share page, with a note about this answer. */
function setShareLink(result: string) {
  const params = new URLSearchParams({ from: "testing-wallet", result, time: new Date().toISOString() });
  ($("share-link") as HTMLAnchorElement).href = `https://smart-health-checkin.org/connectathon/share.html#${params}`;
}
