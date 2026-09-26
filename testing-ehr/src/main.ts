// Testing EHR: send a request to a wallet under test, check the response, and
// show what came back. Built for wallet builders: the verdict first, failing
// checks with what to fix, then the data (readable, JSON, and wire layers).
import { platformWallet, wallets as registryWallets, webWallet, type Wallet, type WalletSession, type SmartCheckinRequest } from "@smart-health-checkin/client";
import { validateSmartCheckinRequest } from "@smart-health-checkin/client/model";
import { buildOrgIsoMdocRequest, extractDcapiResponse } from "@smart-health-checkin/client/wire";
import { checkResponse, fixFor, groupOf, type ArtifactOutcome, type Check, type WireLayers } from "./checks.ts";
import { bindWire, layerFor, wireHtml } from "./wire.ts";
import { esc, readable, resourcesOf } from "./readable.ts";

const SITE = new URL("../", location.href).href; // .../connectathon/
const REPO = "smart-health-checkin/connectathon";
const TESTING_WALLET_ID = "smart-testing-wallet";
/** The testing wallet's faults, and how a spec-following EHR reacts to each. */
const WALLET_FAULTS: Record<string, string> = {
  "wrong-canonical": "sets one record aside",
  "missing-status": "leaves one item unknown",
  "duplicate-status": "leaves one item unknown",
  "wrong-request-id": "rejects the response",
  "unaccepted-media-type": "sets one record aside",
  "oversized": "passes",
  "bad-signature": "warning",
  "bad-encryption": "rejects the response",
  "wrong-origin": "rejects the response",
  "bad-shc-signature": "sets one record aside",
  "combine-allergies-meds": "passes",
};
const RUNS_KEY = "testing-ehr:runs";
const URLS_KEY = "testing-ehr:wallet-urls";

type TestCase = { id: string; title: string; request: string; paths: string[]; summary: string; expect: { ehr: string[]; wallet: string[] }; specSections: string[] };
type Component = { id: string; role: string; label: string };
type LibraryItem = { key: string; item: SmartCheckinRequest["items"][number]; label: string; note: string };
type CardView = { issuer?: string; valid: boolean; detail: string; resources: any[] };
type Run = {
  id: string; at: string; ms: number;
  label: string; caseId?: string; walletId: string; walletName: string; path: "native" | "web"; faults: string[];
  verdict: "pass" | "fail" | "declined";
  headline: string; message?: string;
  request: SmartCheckinRequest; checks: Check[]; smartResponse?: any; responseChars?: number; wire?: WireLayers;
  /** The whole response couldn't be used. */
  rejected?: boolean;
  /** Per item, its valid status or "unknown"; per record, whether it was used. */
  items?: Record<string, string>; artifacts?: Record<string, ArtifactOutcome>;
  cards?: Record<string, CardView>; log: string;
};

const $ = (id: string) => document.getElementById(id)!;
const store = {
  get<T>(key: string, fallback: T): T {
    try { return (JSON.parse(localStorage.getItem(key) ?? "null") as T) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full or blocked; history is a convenience */ }
  },
};

let catalog: TestCase[] = [];
let components: Component[] = [];
let library: LibraryItem[] = [];
let offered: Wallet[] = [];
let mode: "scenario" | "build" | "paste" = "scenario";
const requestFiles = new Map<string, SmartCheckinRequest>();
let runs: Run[] = store.get<Run[]>(RUNS_KEY, []);
let showing: Run | undefined;

// ---------------------------------------------------------------- loading
async function load() {
  const [cat, comps] = await Promise.all([
    fetch(new URL("catalog.json", SITE)).then((r) => r.json()),
    fetch(new URL("components.json", SITE)).then((r) => r.json()).catch(() => []),
  ]);
  catalog = cat.testCases;
  components = comps;
  const files = [...new Set(catalog.map((t) => t.request))];
  await Promise.all(files.map(async (f) => requestFiles.set(f, await fetch(new URL(`requests/${f}`, SITE)).then((r) => r.json()))));
  library = buildLibrary();
  offered = await registryWallets({ registry: new URL("wallets.json", SITE).href, includeUnavailable: true }).catch(() => [platformWallet()]);

  const caseSelect = $("case") as HTMLSelectElement;
  caseSelect.replaceChildren(...catalog.map((t) => new Option(`${t.id} · ${t.title}`, t.id)));
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("case") && catalog.some((t) => t.id === params.get("case"))) caseSelect.value = params.get("case")!;
  caseSelect.onchange = () => { describeCase(); remember(); refresh(); };

  $("item-library").replaceChildren(...library.map((l) => {
    const label = document.createElement("label");
    label.innerHTML = `<input type="checkbox" value="${esc(l.key)}"><span>${esc(l.label)}<small>${esc(l.note)}</small></span>`;
    return label;
  }));
  $("item-library").addEventListener("change", refresh);
  ($("paste") as HTMLTextAreaElement).value = JSON.stringify(requestFiles.get("baseline-2.json") ?? {}, null, 2);
  $("paste").addEventListener("input", refresh);
  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg button")) b.onclick = () => setMode(b.dataset.mode as typeof mode);

  $("faults").replaceChildren(...Object.entries(WALLET_FAULTS).map(([f, effect]) => {
    const label = document.createElement("label");
    label.className = "fault";
    label.innerHTML = `<input type="checkbox" value="${f}"> ${f} <small>${esc(effect)}</small>`;
    return label;
  }));
  $("faults").addEventListener("change", refresh);
  ($("add-wallet") as HTMLFormElement).onsubmit = (e) => { e.preventDefault(); addWalletUrl(); };
  $("send").onclick = () => send();
  $("history-btn").onclick = () => { $("history").hidden = !$("history").hidden; renderHistory(); };
  $("clear-history").onclick = () => { runs = []; saveRuns(); renderHistory(); };

  renderWallets(params.get("wallet") ?? TESTING_WALLET_ID);
  describeCase();
  refresh();
  renderHistory();
}

/** Every distinct item across the scenario requests, to build a request from. */
function buildLibrary(): LibraryItem[] {
  const out: LibraryItem[] = [];
  const seen = new Set<string>();
  for (const req of requestFiles.values()) {
    for (const item of req.items) {
      const sig = JSON.stringify(item);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const c: any = item.content;
      const what =
        c.kind === "form.fhir"
          ? `form, ${c.questionnaire ? "inline" : "by reference"}`
          : [
              c.profiles?.map((p: string) => p.split("/").pop()).join(", "),
              c.profilesFrom?.length ? `profiles from ${c.profilesFrom.map((p: string) => p.split("/").pop()).join(", ")}` : "",
              c.resourceTypes?.join(", "),
            ].filter(Boolean).join(" · ") || "anything";
      const card = item.accept.includes("application/smart-health-card") ? " · health card accepted" : "";
      out.push({ key: `lib-${out.length}`, item, label: item.title, note: `${item.id}: ${what}${card}` });
    }
  }
  return out;
}

function setMode(next: typeof mode) {
  mode = next;
  for (const b of document.querySelectorAll<HTMLButtonElement>(".seg button")) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  for (const p of document.querySelectorAll<HTMLElement>("[data-panel]")) p.hidden = p.dataset.panel !== mode;
  refresh();
}

const currentCase = (): TestCase => catalog.find((t) => t.id === ($("case") as HTMLSelectElement).value)!;

function describeCase() {
  const tc = currentCase();
  $("case-info").innerHTML = `<p>${esc(tc.summary)} <a href="${new URL(`requests/${tc.request}`, SITE).href}">${esc(tc.request)}</a></p>
    <p><b>Wallet should:</b> ${esc(tc.expect.wallet.join("; "))}</p>
    ${tc.paths.length === 1 ? `<p>Meant for the ${esc(tc.paths[0])} path.</p>` : ""}`;
}

/** The request Send will use, or why there isn't one. */
function currentRequest(): { ok: true; request: SmartCheckinRequest; label: string; short: string; caseId?: string } | { ok: false; error: string } {
  if (mode === "scenario") {
    const tc = currentCase();
    const req = requestFiles.get(tc.request);
    return req ? { ok: true, request: req, label: `${tc.id} · ${tc.title}`, short: tc.id, caseId: tc.id } : { ok: false, error: "Loading the scenario…" };
  }
  if (mode === "build") {
    const keys = [...document.querySelectorAll<HTMLInputElement>("#item-library input:checked")].map((i) => i.value);
    const items = library.filter((l) => keys.includes(l.key)).map((l) => l.item);
    if (!items.length) return { ok: false, error: "Tick at least one item." };
    const ids = items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) return { ok: false, error: "Two ticked items share an id. Untick one of them." };
    const request = { type: "smart-health-checkin-request", version: "1", id: "custom", purpose: "Testing EHR: custom request", fhirVersions: ["4.0.1"], items } as SmartCheckinRequest;
    const v = validateSmartCheckinRequest(request);
    const n = `${items.length} item${items.length === 1 ? "" : "s"}`;
    return v.ok ? { ok: true, request, label: `Custom · ${n}`, short: n } : { ok: false, error: v.error };
  }
  try {
    const request = JSON.parse(($("paste") as HTMLTextAreaElement).value);
    const v = validateSmartCheckinRequest(request);
    return v.ok ? { ok: true, request, label: `Pasted · ${request.items.length} item${request.items.length === 1 ? "" : "s"}`, short: "your request" } : { ok: false, error: v.error };
  } catch (e) {
    return { ok: false, error: `Not JSON: ${(e as Error).message}` };
  }
}

// ---------------------------------------------------------------- wallets
const customUrls = (): string[] => store.get<string[]>(URLS_KEY, []);

function allWallets(): Wallet[] {
  const custom = customUrls().map((url) => {
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    return webWallet({ id: `url:${url}`, name: `My wallet (${host})`, walletUrl: url, description: "Added by URL · not registered" });
  });
  return [...offered, ...custom];
}

function selectedWallet(): Wallet | undefined {
  const id = document.querySelector<HTMLInputElement>('input[name="wallet"]:checked')?.value;
  return allWallets().find((w) => w.id === id);
}

const selectedFaults = (): string[] => [...document.querySelectorAll<HTMLInputElement>("#faults input:checked")].map((i) => i.value);

function renderWallets(select?: string) {
  const current = select ?? selectedWallet()?.id;
  const colors = ["#6E4FA2", "#0E6FB8", "#1A8C76", "#B85C17", "#B5345C", "#3B6E8F"];
  const color = (s: string) => colors[[...s].reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length];
  $("wallets").replaceChildren(...allWallets().map((w) => {
    const label = document.createElement("label");
    label.className = "wallet";
    const sub =
      w.kind === "platform"
        ? w.available ? "Digital Credentials API · on a computer, scan with a phone" : `Not available here: ${w.unavailableReason ?? "no Digital Credentials API"}`
        : w.id === TESTING_WALLET_ID ? "Reference wallet · faults available" : w.description ?? w.entry?.walletUrl ?? "";
    const icon = w.iconUrl ? `<img alt="" src="${esc(w.iconUrl)}">` : esc(w.name[0]);
    const removable = w.id.startsWith("url:");
    label.innerHTML = `<input type="radio" name="wallet" value="${esc(w.id)}" ${w.id === current ? "checked" : ""} ${w.available ? "" : "disabled"}>
      <span class="ico" style="background:${w.iconUrl ? "transparent" : color(w.name)}">${icon}</span>
      <span class="t"><b>${esc(w.name)}</b><small>${esc(sub)}</small></span>
      ${removable ? `<button type="button" class="x" aria-label="Remove ${esc(w.name)}">×</button>` : ""}`;
    label.querySelector("input")!.addEventListener("change", () => { remember(); refresh(); });
    label.querySelector(".x")?.addEventListener("click", (e) => {
      e.preventDefault();
      store.set(URLS_KEY, customUrls().filter((u) => `url:${u}` !== w.id));
      renderWallets(TESTING_WALLET_ID);
      refresh();
    });
    return label;
  }));
  if (!selectedWallet()) document.querySelector<HTMLInputElement>('input[name="wallet"]:not(:disabled)')?.click();
}

function addWalletUrl() {
  const input = $("wallet-url") as HTMLInputElement;
  let url: URL;
  try { url = new URL(input.value); } catch { input.setCustomValidity("Enter a full URL"); input.reportValidity(); return; }
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    input.setCustomValidity("Use https (or localhost while developing)");
    input.reportValidity();
    return;
  }
  input.setCustomValidity("");
  store.set(URLS_KEY, [...new Set([...customUrls(), url.href])]);
  input.value = "";
  renderWallets(`url:${url.href}`);
  refresh();
}

function remember() {
  const w = selectedWallet();
  history.replaceState(null, "", `#case=${($("case") as HTMLSelectElement).value}${w ? `&wallet=${encodeURIComponent(w.id)}` : ""}`);
}

/** Update the fault box, the request state line, and the Send button. */
function refresh() {
  const w = selectedWallet();
  const r = currentRequest();
  $("fault-box").hidden = w?.id !== TESTING_WALLET_ID;
  const faults = w?.id === TESTING_WALLET_ID ? selectedFaults() : [];
  $("fault-count").textContent = faults.length ? `${faults.length} on` : "";
  const state = $("request-state");
  state.className = `small ${r.ok ? "ok-line" : "bad-line"}`;
  state.textContent = r.ok ? `${r.request.items.length} item${r.request.items.length === 1 ? "" : "s"} · valid request` : r.error;
  const button = $("send") as HTMLButtonElement;
  button.disabled = !r.ok || !w || !w.available;
  button.innerHTML = r.ok && w ? `Send ${esc(r.short)} to ${esc(w.name)}${faults.length ? `<small>with faults: ${esc(faults.join(", "))}</small>` : ""}` : "Send";
  $("setup-summary").textContent = r.ok && w ? `${r.label} → ${w.name}` : "Set up a run";
}

// ---------------------------------------------------------------- running
function send() {
  const r = currentRequest();
  const chosen = selectedWallet();
  if (!r.ok || !chosen) return;
  const faults = chosen.id === TESTING_WALLET_ID ? selectedFaults() : [];
  let wallet = chosen;
  if (faults.length && chosen.entry) {
    const url = new URL(chosen.entry.walletUrl);
    url.hash = `faults=${faults.join(",")}&testing=1`;
    wallet = webWallet({ ...chosen.entry, walletUrl: url.href });
  }
  // Open the wallet now, inside the click, so the browser allows its tab.
  const session = wallet.open();
  const request = { ...r.request, id: `testing-ehr-${r.caseId ?? "custom"}-${crypto.randomUUID()}` } as SmartCheckinRequest;
  void run({ request, label: r.label, caseId: r.caseId, wallet: chosen, session, faults });
}

// The SMART starburst, as <smart-checkin-picker> shows it while waiting.
const STARBURST = `<svg viewBox="59 -1 91 75" aria-hidden="true" focusable="false"><polygon fill="#722772" points="83.91 0 93.42 0 104.56 18.47 116.03 0 125.28 0 104.58 33.96"/><polygon fill="#e24a31" points="60.61 35.72 65.37 28.16 87.76 28.16 76.67 9.49 81.3 1.87 101.89 35.72"/><polygon fill="#e77d26" points="128 1.73 132.76 9.55 121.5 28.16 144.06 28.16 148.69 35.72 107.4 35.72"/><polygon fill="#89bf44" points="148.72 38.78 143.97 46.33 121.57 46.33 132.66 65.16 128.03 72.78 107.44 38.78"/><polygon fill="#f1b42a" points="81.28 72.77 76.53 64.94 87.78 46.33 65.23 46.33 60.6 38.78 101.89 38.78"/><polygon fill="#64aed0" points="125.46 73.22 115.89 73.22 104.68 54.63 93.14 73.22 83.82 73.22 104.66 39.04"/></svg>`;

async function run(input: { request: SmartCheckinRequest; label: string; caseId?: string; wallet: Wallet; session: WalletSession; faults: string[] }) {
  const { request, wallet } = input;
  const started = performance.now();
  const at = new Date().toISOString();
  const path: Run["path"] = wallet.kind === "platform" ? "native" : "web";
  ($("send") as HTMLButtonElement).disabled = true;
  $("status").textContent = "Waiting for the wallet…";
  $("result").innerHTML = `<div class="waiting" data-motion="subtle"><span class="wait-mark">${STARBURST}<span class="veil"></span></span><div><b>Waiting for ${esc(wallet.name)}</b><p class="small">${path === "web" ? "It opened in a new tab. Share there, and the result shows here." : "The system sheet should be open."}</p></div></div>`;
  $("log").textContent = "";
  if (matchMedia("(max-width: 860px)").matches) ($("setup") as HTMLDetailsElement).open = false;

  const base = { id: crypto.randomUUID(), at, label: input.label, caseId: input.caseId, walletId: wallet.id, walletName: wallet.name, path, faults: input.faults, request };
  let result: Run;
  try {
    const bundle = await buildOrgIsoMdocRequest(request, { origin: location.origin, readerAuth: false });
    const raw = await input.session.getCredential(bundle.navigatorArgument);
    const normalized = extractDcapiResponse(raw);
    const credential = typeof normalized === "string" ? { protocol: (raw as { protocol?: string })?.protocol ?? "org-iso-mdoc", data: { response: normalized } } : normalized;
    $("status").textContent = "Checking the response…";
    const checked = await checkResponse({ request, credential, verifierKeyPair: bundle.verifierKeyPair, verifierPublicJwk: bundle.verifierPublicJwk, encryptionInfoBytes: bundle.encryptionInfoBytes, origin: location.origin,
      navigatorArgument: bundle.navigatorArgument, deviceRequestBytes: bundle.deviceRequestBytes, pageUrl: location.href,
      walletOrigin: wallet.entry ? new URL(wallet.entry.walletUrl).origin : undefined });
    result = {
      ...base, ms: Math.round(performance.now() - started),
      verdict: checked.checks.some((c) => c.outcome === "fail") ? "fail" : "pass",
      headline: headlineFor(checked.checks, checked.rejected),
      rejected: checked.rejected, items: checked.items, artifacts: checked.artifacts,
      checks: checked.checks, smartResponse: checked.smartResponse, responseChars: checked.responseBytes, wire: checked.wire,
      cards: await decodeCards(checked.smartResponse, checked.checks),
      log: "",
    };
  } catch (e) {
    const message = (e as Error).message;
    const declined = ["NotAllowedError", "AbortError", "WalletDeclinedError"].includes((e as Error).name);
    result = {
      ...base, ms: Math.round(performance.now() - started),
      verdict: declined ? "declined" : "fail",
      headline: declined ? `Declined in ${wallet.name}` : "The wallet didn't return a response",
      message, checks: [], log: "",
    };
  }
  result.log = logFor(result);
  const failedCount = result.checks.filter((c) => c.outcome === "fail").length;
  const warnCount = result.checks.filter((c) => c.outcome === "warn").length;
  $("status").textContent =
    result.verdict === "pass" ? (warnCount ? `Passed with ${warnCount} warning(s).` : "All checks passed.")
    : result.verdict === "declined" ? `The wallet declined or was closed: ${result.message}`
    : result.checks.length ? `${failedCount} check(s) failed${result.rejected ? "; response rejected" : ""}.` : `Error: ${result.message}`;
  runs = [result, ...runs].slice(0, 20);
  saveRuns();
  show(result);
  refresh();
}

/** One line saying what happened: rejected, usable with problems, or passed (with warnings). */
function headlineFor(checks: Check[], rejected: boolean): string {
  const fails = checks.filter((c) => c.outcome === "fail");
  const warns = checks.filter((c) => c.outcome === "warn").length;
  const w = warns ? `, ${warns} warning${warns === 1 ? "" : "s"}` : "";
  if (rejected) return `Response rejected: ${fails.find((c) => c.scope === "response")?.title ?? "see below"}`;
  if (fails.length) return `Response usable, ${fails.length} problem${fails.length === 1 ? "" : "s"} with items or records${w}`;
  const total = checks.filter((c) => c.outcome !== "info").length;
  return warns ? `Passed with ${warns} warning${warns === 1 ? "" : "s"}` : `All ${total} checks passed`;
}

function logFor(r: Run): string {
  return [
    `Testing EHR run ${r.at}`,
    `Scenario ${r.label}; wallet ${r.walletId}; path ${r.path}${r.faults.length ? `; faults ${r.faults.join(",")}` : ""}`,
    ...(r.checks.length
      ? r.checks.map((c) => `[${c.outcome.toUpperCase()}] ${c.id}${c.rule ? ` (${c.rule})` : ""}: ${c.title}${c.detail ? ` — ${c.detail}` : ""}`)
      : [`${r.verdict === "declined" ? "DECLINED" : "ERROR"}: ${r.message}`]),
  ].join("\n");
}

/** Keep history within localStorage: only the latest few runs keep their bulky parts. */
function saveRuns() {
  const slim = runs.map((r, i) => (i < 3 && JSON.stringify(r).length < 1_500_000 ? r : { ...r, smartResponse: undefined, wire: undefined, cards: undefined }));
  store.set(RUNS_KEY, slim);
}

async function decodeCards(smart: any, checks: Check[]): Promise<Record<string, CardView>> {
  const out: Record<string, CardView> = {};
  for (const a of smart?.artifacts ?? []) {
    if (a.mediaType !== "application/smart-health-card") continue;
    for (const [n, jws] of (a.value?.verifiableCredential ?? []).entries()) {
      const check = checks.find((c) => c.id === `shc-${a.id}-${n}`);
      try {
        const p = String(jws).split(".")[1]!;
        const bytes = Uint8Array.from(atob(p.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((p.length + 3) % 4)), (c) => c.charCodeAt(0));
        const payload = JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text());
        out[`${a.id}-${n}`] = { issuer: payload.iss, valid: check?.outcome === "pass", detail: check?.detail ?? "", resources: resourcesOf(payload.vc?.credentialSubject?.fhirBundle) };
      } catch (e) {
        out[`${a.id}-${n}`] = { valid: false, detail: `Couldn't decode: ${(e as Error).message}`, resources: [] };
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- showing a run
function show(r: Run) {
  showing = r;
  const mark = r.verdict === "pass" ? "✓" : r.verdict === "declined" ? "–" : "✕";
  const kb = r.responseChars ? `${(r.responseChars / 1024).toFixed(1)} KB` : "";
  const failures = r.checks.filter((c) => c.outcome === "fail");
  const warnings = r.checks.filter((c) => c.outcome === "warn");
  const passed = r.checks.filter((c) => c.outcome === "pass" || c.outcome === "info");

  const verdict = `<section class="verdict ${r.verdict}"><div class="head"><span class="mark">${mark}</span><b>${esc(r.headline)}</b></div>
    <div class="meta"><span>${esc(r.label)}</span><span>→ ${esc(r.walletName)}</span>${r.faults.length ? `<span>faults: ${esc(r.faults.join(", "))}</span>` : ""}${kb ? `<span>${kb}</span>` : ""}<span>${(r.ms / 1000).toFixed(1)} s</span><span>${new Date(r.at).toLocaleTimeString()}</span></div>
    ${r.message ? `<p class="small">${esc(r.message)}</p>` : ""}
    <div class="actions"><a id="file" class="btn primary" target="_blank" rel="noopener" href="${esc(resultLink(r))}">File this result</a><button type="button" class="btn" data-act="download">Download run</button><a class="share-link" target="_blank" rel="noopener" href="${esc(shareLink("testing-ehr", r.verdict, r.at))}">Tell us how it went</a></div></section>`;

  const failCard = (c: Check, warn = false) =>
    `<div class="failure ${warn ? "warn" : ""}"><b>${warn ? "!" : "✕"} ${esc(c.title)}</b>${c.detail ? `<div class="got">${esc(c.detail)}</div>` : ""}${fixFor(c.id) ? `<div class="fix"><b>Fix:</b> ${esc(fixFor(c.id))}</div>` : ""}${c.section ? `<a href="${esc(c.section)}" target="_blank" rel="noopener">Spec ${esc(c.rule ?? "")}</a>` : ""}${layerFor(c.id) && r.wire ? ` <a href="#layer-${layerFor(c.id)}" data-goto-layer="${layerFor(c.id)}">See the bytes</a>` : ""}</div>`;
  const whole = failures.filter((c) => c.scope === "response");
  const partial = failures.filter((c) => c.scope !== "response");
  const failuresHtml = (whole.length ? `<section class="card"><h2>Why the response was rejected <span>${whole.length}</span></h2>${whole.map((c) => failCard(c)).join("")}</section>` : "")
    + (partial.length ? `<section class="card"><h2>Problems with items or records <span>${partial.length}</span></h2><p class="small">The rest of the response is still used.</p>${partial.map((c) => failCard(c)).join("")}</section>` : "");
  const warningsHtml = warnings.length ? `<section class="card"><h2>Warnings <span>${warnings.length}</span></h2>${warnings.map((c) => failCard(c, true)).join("")}</section>` : "";

  const groups = new Map<string, Check[]>();
  for (const c of passed) groups.set(groupOf(c.id), [...(groups.get(groupOf(c.id)) ?? []), c]);
  const passedHtml = passed.length
    ? `<section class="card"><h2>Passed checks <span>${passed.length}</span></h2>${[...groups].map(([g, list]) =>
        `<details class="group"><summary>${esc(g)}<span class="n">${list.length}</span></summary>${list.map((c) =>
          `<div class="check"><span class="dot ${c.outcome}"></span><span>${esc(c.title)}${c.section ? ` <a href="${esc(c.section)}" target="_blank" rel="noopener">${esc(c.rule ?? "spec")}</a>` : ""}</span>${c.detail ? `<small>${esc(c.detail)}</small>` : ""}</div>`).join("")}</details>`).join("")}</section>`
    : "";

  $("result").innerHTML = verdict + failuresHtml + warningsHtml + passedHtml + (r.smartResponse ? itemsHtml(r) : "") + (r.wire?.layers ? wireHtml(r.wire, [...failures, ...warnings]) : "");
  $("log").textContent = r.log;
  $("result").querySelector('[data-act="download"]')?.addEventListener("click", () => download(r));
  if (r.wire?.layers) bindWire($("result"), r.wire, `${r.label} → ${r.walletName}`);
  for (const a of $("result").querySelectorAll<HTMLAnchorElement>("[data-goto-layer]")) a.addEventListener("click", (e) => {
    e.preventDefault();
    const target = document.getElementById(`layer-${a.dataset.gotoLayer}`) as HTMLDetailsElement | null;
    if (!target) return;
    target.open = true;
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  for (const b of $("result").querySelectorAll<HTMLButtonElement>(".view button")) b.onclick = () => toggleView(b);
  for (const b of $("result").querySelectorAll<HTMLButtonElement>("[data-copy]")) b.onclick = () => copyJson(b);
  renderHistory();
}

function itemsHtml(r: Run): string {
  const smart = r.smartResponse;
  const statuses: any[] = smart.requestStatus ?? [];
  const artifacts: any[] = smart.artifacts ?? [];
  const cards = r.request.items.map((item) => {
    const status = statuses.filter((s) => s.item === item.id);
    const outcome = r.items?.[item.id];
    const statusText = outcome === "unknown"
      ? `unknown (${status.length === 1 ? `code ${status[0].status}` : status.length ? `${status.length} statuses` : "no status"})`
      : outcome ?? (status.length === 1 ? status[0].status : status.length ? `${status.length} statuses` : "no status");
    const listed = artifacts.filter((a) => (a.fulfills ?? []).includes(item.id));
    const setAside = r.artifacts ? listed.filter((a) => r.artifacts![a.id] === "rejected") : [];
    const mine = listed.filter((a) => !setAside.includes(a));
    const fhir = mine.filter((a) => a.mediaType === "application/fhir+json").flatMap((a) => resourcesOf(a.value));
    const cardViews = mine
      .filter((a) => a.mediaType === "application/smart-health-card")
      .flatMap((a) => (a.value?.verifiableCredential ?? []).map((_: string, n: number) => r.cards?.[`${a.id}-${n}`]))
      .filter(Boolean) as CardView[];
    const sources = [...new Set(mine.map((a) => (a.mediaType === "application/smart-health-card" ? "SMART Health Card" : "FHIR")))].join(" + ") || "no artifact";
    const count = fhir.length + cardViews.reduce((n, c) => n + c.resources.length, 0);
    const readableHtml =
      [
        fhir.length ? readable(fhir) : "",
        ...cardViews.map((c) => `<div class="card-trust">Health card from <code>${esc(c.issuer ?? "unknown issuer")}</code>: ${c.valid ? "signature valid" : "signature NOT valid"}${c.detail ? ` · ${esc(c.detail)}` : ""}</div>${readable(c.resources)}`),
      ].join("") || `<p class="small">Nothing returned${status[0]?.message ? `: ${esc(status[0].message)}` : "."}</p>`;
    const json = JSON.stringify(mine, null, 2);
    const shown = json.length > 400_000 ? json.slice(0, 400_000) + "\n… (truncated; download the run for all of it)" : json;
    const asideHtml = setAside.length ? `<p class="small">Set aside: ${setAside.map((a) => `<code>${esc(String(a.id))}</code>`).join(", ")} (see Problems with items or records).</p>` : "";
    return `<article class="item"><div class="item-head"><b>${esc(item.title)}</b><span class="st ${esc(outcome === "unknown" ? "missing" : status.length === 1 ? status[0].status : "missing")}">${esc(statusText)}</span><span class="src">${count} resource${count === 1 ? "" : "s"} · ${esc(sources)}</span>
      <span class="view"><button type="button" aria-pressed="true" data-v="readable">Readable</button><button type="button" aria-pressed="false" data-v="json">JSON</button></span></div>
      <div class="item-body" data-body="readable">${asideHtml}${readableHtml}</div>
      <div class="item-body" data-body="json" hidden><div class="json-tools"><button type="button" class="btn" data-copy>Copy</button></div><pre class="json">${esc(shown)}</pre></div></article>`;
  });
  return `<section class="card"><h2>What came back <span>${r.request.items.length} item${r.request.items.length === 1 ? "" : "s"}</span></h2>${cards.join("")}</section>`;
}

function toggleView(button: HTMLButtonElement) {
  const item = button.closest(".item")!;
  for (const b of item.querySelectorAll<HTMLButtonElement>(".view button")) b.setAttribute("aria-pressed", String(b === button));
  for (const body of item.querySelectorAll<HTMLElement>("[data-body]")) body.hidden = body.dataset.body !== button.dataset.v;
}

function copyJson(button: HTMLButtonElement) {
  const text = button.closest(".item-body")!.querySelector("pre")!.textContent ?? "";
  navigator.clipboard.writeText(text).then(() => { button.textContent = "Copied"; setTimeout(() => (button.textContent = "Copy"), 1500); }, () => {});
}

function download(r: Run) {
  const blob = new Blob([JSON.stringify({ ...r, cards: undefined }, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `testing-ehr-${(r.caseId ?? "custom").toLowerCase()}-${r.walletId.replace(/[^a-z0-9-]/gi, "-").slice(0, 40)}-${r.at.slice(0, 19).replace(/[:T-]/g, "")}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function renderHistory() {
  $("history-btn").textContent = `History · ${runs.length}`;
  $("history-count").textContent = String(runs.length);
  if (!runs.length) { $("history-list").innerHTML = `<p class="small">No runs yet.</p>`; return; }
  $("history-list").replaceChildren(...runs.map((r) => {
    const b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-current", String(showing?.id === r.id));
    b.innerHTML = `<span class="dot ${r.verdict === "pass" ? "pass" : r.verdict === "declined" ? "declined" : "fail"}"></span><b>${esc(r.label)}</b><span class="when">${new Date(r.at).toLocaleTimeString()}</span><small>${esc(r.walletName)} · ${esc(r.headline)}</small>`;
    b.onclick = () => show(r);
    return b;
  }));
}

/** The share page, with a note about what was just tried (not a structured report). */
function shareLink(from: string, result: string, at: string): string {
  return `https://smart-health-checkin.org/connectathon/share.html#${new URLSearchParams({ from, result, time: at })}`;
}

function resultLink(r: Run): string {
  const label = (id: string) => components.find((c) => c.id === id)?.label;
  const tc = catalog.find((t) => t.id === r.caseId);
  const result = r.verdict === "pass" ? "pass" : r.verdict === "declined" ? "blocked" : "fail";
  const log = r.log.length > 6000 ? r.log.slice(0, 6000) + "\n… (truncated)" : r.log;
  const p = new URLSearchParams({
    template: "test-result.yml",
    title: `[result] ${tc?.id ?? "custom"} ${label(r.walletId)?.split(" (")[0] ?? r.walletName} ${result}`,
    ...(tc ? { scenario: `${tc.id} ${tc.title}` } : {}),
    ehr: label("smart-testing-ehr") ?? "Testing EHR (SMART Health IT, smart-testing-ehr)",
    ...(label(r.walletId) ? { wallet: label(r.walletId)! } : {}),
    path: r.path,
    result,
    device: navigator.userAgent,
    evidence: log,
  });
  return `https://github.com/${REPO}/issues/new?${p}`;
}

load()
  .then(() => { if (runs[0]) show(runs[0]); })
  .catch((e) => { $("result").innerHTML = `<div class="empty">Could not load the catalog or registry: ${esc((e as Error).message)}</div>`; });
