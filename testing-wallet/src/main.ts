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

const STATUSES = ["fulfilled", "partial", "unavailable", "declined", "unsupported", "error"] as const;
const FAULTS: Record<string, string> = {
  "wrong-canonical": "QuestionnaireResponse.questionnaire doesn't match the request",
  "missing-status": "Leave one item without a status",
  "duplicate-status": "Give one item two statuses",
  "wrong-request-id": "requestId doesn't match",
  "unaccepted-media-type": "Return an artifact in a media type the item didn't accept",
  "oversized": "Pad the response past 3 MB",
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
  "oversized": "passes",
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
  large: { label: "Aria Test, large record (over 2 MB)", file: "data/large-record.json" },
};

// ---------------------------------------------------------------- settings in the URL fragment
function readSettings() {
  const p = new URLSearchParams(location.hash.slice(1));
  return {
    patient: PATIENTS[p.get("patient") ?? ""] ? p.get("patient")! : "aria",
    faults: new Set((p.get("faults") ?? "").split(",").filter((f) => FAULTS[f])),
    status: new Map((p.get("status") ?? "").split(",").filter(Boolean).map((kv) => kv.split(":") as [string, string])),
    testing: p.get("testing") === "1" || p.has("faults") || p.has("status"),
  };
}
const settings = readSettings();
function writeSettings() {
  const p = new URLSearchParams();
  if (settings.patient !== "aria") p.set("patient", settings.patient);
  if (settings.faults.size) p.set("faults", [...settings.faults].join(","));
  if (settings.status.size) p.set("status", [...settings.status].map(([k, v]) => `${k}:${v}`).join(","));
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
  if (settings.faults.has("oversized")) {
    artifacts.push({ id: "padding", mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [items[0]!.item.id],
      value: { resourceType: "Basic", code: { text: "padding" }, extension: [{ url: "https://smart-health-checkin.org/connectathon/padding", valueString: "x".repeat(3_200_000) }] } });
  }
  return {
    type: "smart-health-checkin-response",
    version: "1",
    requestId: settings.faults.has("wrong-request-id") ? `${s.request.id}-wrong` : s.request.id,
    artifacts,
    requestStatus: statuses,
  };
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
  $("raw-request").textContent = JSON.stringify(s.request, null, 2);
  const redraw = async () => {
    shareButton.disabled = true;
    prepared = await prepare(s);
    renderItems(prepared);
    renderStatusOverrides(prepared);
    shareButton.disabled = declineButton.disabled = false;
  };
  renderPatientPicker(() => void redraw());
  await redraw();
  ($("share") as HTMLButtonElement).onclick = async () => {
    const button = $("share") as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "Sharing…";
    try {
      const smartResponse = await buildResponse(s, prepared);
      $("raw-response").textContent = JSON.stringify(smartResponse, (k, v) => (typeof v === "string" && v.length > 2000 ? `${v.slice(0, 200)}… (${v.length} chars)` : v), 2);
      const credential = await seal({ smartResponse, encryptionInfoBytes: s.encryptionInfoBytes, ehrOrigin: s.ehrOrigin, faults: settings.faults });
      reply(s, { outcome: "approved", credential });
      $("consent").hidden = true;
      $("done").hidden = false;
      $("done-text").textContent = settings.faults.size ? `Sent, with faults: ${[...settings.faults].join(", ")}.` : "Sent. You can close this tab.";
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
      $("raw-response").textContent = JSON.stringify(smartResponse, null, 2);
      const credential = await seal({ smartResponse, encryptionInfoBytes: s.encryptionInfoBytes, ehrOrigin: s.ehrOrigin, faults: new Set() });
      reply(s, { outcome: "approved", credential });
      $("consent").hidden = true;
      $("done").hidden = false;
      $("done-text").textContent = "Declined every item; the clinic was told. You can close this tab.";
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
