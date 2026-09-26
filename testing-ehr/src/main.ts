// Testing EHR: send any connectathon request to any wallet and check the response.
import {
  detectDcApiSupport,
  extractDcapiResponse,
  validateSmartCheckinRequest,
  type SmartCheckinRequest,
} from "@smart-health-checkin/client";
import { buildOrgIsoMdocRequest } from "@smart-health-checkin/client/wire";
import "@smart-health-checkin/client/ui";
import type { SmartCheckinPicker } from "@smart-health-checkin/client/ui";
import { resolveResponders, type Responder } from "@smart-health-checkin/client";
import { checkResponse, type Check } from "./checks.ts";

const SITE = new URL("../", location.href).href; // .../connectathon/
const REPO = "smart-health-checkin/connectathon";
const TESTING_WALLET_ID = "smart-testing-wallet";
const WALLET_FAULTS = ["wrong-canonical", "missing-status", "duplicate-status", "wrong-request-id", "unaccepted-media-type", "oversized", "bad-signature", "bad-encryption", "wrong-origin", "bad-shc-signature", "combine-allergies-meds"];

type TestCase = { id: string; title: string; request: string; paths: string[]; summary: string; expect: { ehr: string[]; wallet: string[] }; specSections: string[] };
type Component = { id: string; role: string; label: string };

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}

let catalog: TestCase[] = [];
let responders: Responder[] = [];
const picker = document.getElementById("picker") as SmartCheckinPicker & HTMLElement;
let components: Component[] = [];

async function load() {
  const [cat, comps, list] = await Promise.all([
    fetch(new URL("catalog.json", SITE)).then((r) => r.json()),
    fetch(new URL("components.json", SITE)).then((r) => r.json()).catch(() => []),
    resolveResponders({ platform: true, webWallets: new URL("wallets.json", SITE).href }),
  ]);
  catalog = cat.testCases;
  components = comps;
  responders = list;

  const caseSelect = $("case") as HTMLSelectElement;
  caseSelect.replaceChildren(...catalog.map((t) => el("option", { value: t.id }, `${t.id} ${t.title}`)));
  const dc = detectDcApiSupport();
  if (dc.state === "unsupported") {
    $("platform-note").textContent = `This device's own wallet isn't offered: ${dc.reason}.`;
    $("platform-note").hidden = false;
  }
  $("faults").replaceChildren(
    ...WALLET_FAULTS.map((f) => el("label", { className: "fault" }, el("input", { type: "checkbox", value: f }), " ", el("code", {}, f))),
  );
  $("faults").addEventListener("change", offerWallets);

  const params = new URLSearchParams(location.hash.slice(1));
  if (params.get("case") && catalog.some((t) => t.id === params.get("case"))) caseSelect.value = params.get("case")!;
  caseSelect.onchange = () => { describe(); remember(); };
  picker.addEventListener("smart-checkin-choose", (e) => {
    const { responder, getCredential } = (e as CustomEvent).detail as { responder: Responder; getCredential?: (arg: unknown) => Promise<unknown> };
    void run(responder, getCredential);
  });
  offerWallets();
  describe();
}

// The picker opens the wallet inside the click, so the testing wallet's URL
// must already carry the chosen faults: rebuild the list when they change.
function offerWallets() {
  const faults = [...document.querySelectorAll<HTMLInputElement>("#faults input:checked")].map((i) => i.value);
  picker.responders = responders.map((r) => {
    if (r.id !== TESTING_WALLET_ID || !r.wallet || !faults.length) return r;
    const url = new URL(r.wallet.walletUrl);
    url.hash = `faults=${faults.join(",")}&testing=1`;
    return { ...r, description: `With faults: ${faults.join(", ")}`, wallet: { ...r.wallet, walletUrl: url.href } };
  });
}

function remember() {
  history.replaceState(null, "", `#case=${($("case") as HTMLSelectElement).value}`);
}

function describe() {
  const tc = catalog.find((t) => t.id === ($("case") as HTMLSelectElement).value)!;
  $("case-info").replaceChildren(
    el("p", {}, tc.summary, " ", el("a", { href: new URL(`requests/${tc.request}`, SITE).href }, tc.request)),
    el("p", { className: "small" }, el("b", {}, "EHR should: "), tc.expect.ehr.join("; ")),
    el("p", { className: "small" }, el("b", {}, "Wallet should: "), tc.expect.wallet.join("; ")),
    ...(tc.paths.length === 1 ? [el("p", { className: "small muted" }, `This scenario is meant for the ${tc.paths[0]} path.`)] : []),
  );
  picker.reset();
}

function renderChecks(checks: Check[]) {
  const rows = checks.map((c) =>
    el("tr", { className: c.outcome },
      el("td", {}, el("span", { className: `pill ${c.outcome}` }, c.outcome)),
      el("td", {}, c.section ? el("a", { href: c.section, target: "_blank" }, c.title) : c.title),
      el("td", { className: "detail" }, c.detail)));
  $("checks").replaceChildren(el("table", {}, el("thead", {}, el("tr", {}, el("th", {}, "Result"), el("th", {}, "Check"), el("th", {}, "Detail"))), el("tbody", {}, ...rows)));
}

function resultLink(tc: TestCase, walletId: string, path: string, result: string, log: string) {
  const label = (id: string) => components.find((c) => c.id === id)?.label;
  const p = new URLSearchParams({
    template: "test-result.yml",
    title: `[result] ${tc.id} ${label(walletId)?.split(" (")[0] ?? walletId} ${result}`,
    scenario: `${tc.id} ${tc.title}`,
    ehr: label("smart-testing-ehr") ?? "Testing EHR (SMART Health IT, smart-testing-ehr)",
    ...(label(walletId) ? { wallet: label(walletId)! } : {}),
    path,
    result,
    device: navigator.userAgent,
    evidence: log.length > 6000 ? log.slice(0, 6000) + "\n… (truncated)" : log,
  });
  return `https://github.com/${REPO}/issues/new?${p}`;
}

async function run(responder: Responder, walletGetter?: (arg: unknown) => Promise<unknown>) {
  $("status").textContent = "Building the request…";
  $("checks").replaceChildren();
  $("file").hidden = true;
  $("smart-response").textContent = "";
  const tc = catalog.find((t) => t.id === ($("case") as HTMLSelectElement).value)!;
  const walletId = responder.id;
  const path = responder.kind === "platform" ? "native" : "web";
  const started = new Date().toISOString();
  try {
    const request = (await (await fetch(new URL(`requests/${tc.request}`, SITE))).json()) as SmartCheckinRequest;
    (request as { id: string }).id = `testing-ehr-${tc.id}-${crypto.randomUUID()}`;
    const reqCheck = validateSmartCheckinRequest(request);
    if (!reqCheck.ok) throw new Error(`the request file is invalid: ${reqCheck.error}`);
    $("sent-request").textContent = JSON.stringify(request, null, 2);

    const bundle = await buildOrgIsoMdocRequest(request, { origin: location.origin, readerAuth: false });

    const getCredential = walletGetter ?? ((arg: unknown) => navigator.credentials.get(arg as CredentialRequestOptions));
    $("status").textContent = "Waiting for the wallet…";
    const raw = await getCredential(bundle.navigatorArgument);
    const normalized = extractDcapiResponse(raw);
    const credential = typeof normalized === "string" ? { protocol: (raw as { protocol?: string })?.protocol ?? "org-iso-mdoc", data: { response: normalized } } : normalized;

    $("status").textContent = "Checking the response…";
    const result = await checkResponse({
      request,
      credential,
      verifierKeyPair: bundle.verifierKeyPair,
      verifierPublicJwk: bundle.verifierPublicJwk,
      encryptionInfoBytes: bundle.encryptionInfoBytes,
      origin: location.origin,
    });
    renderChecks(result.checks);
    if (result.smartResponse) {
      $("smart-response").textContent = JSON.stringify(result.smartResponse, (k, v) => (typeof v === "string" && v.length > 1500 ? `${v.slice(0, 200)}… (${v.length} characters)` : v), 2);
    }
    const failed = result.checks.filter((c) => c.outcome === "fail");
    const verdict = failed.length ? "fail" : "pass";
    $("status").textContent = failed.length ? `${failed.length} check(s) failed.` : "All checks passed.";
    picker.setOutcome(failed.length ? { status: "error", message: `${failed.length} check(s) failed. See the checks below.` } : { status: "completed" });
    const log = [
      `Testing EHR run ${started}`,
      `Scenario ${tc.id} ${tc.title}; wallet ${walletId}; path ${path}`,
      ...result.checks.map((c) => `[${c.outcome.toUpperCase()}] ${c.title}${c.detail ? ` — ${c.detail}` : ""}`),
    ].join("\n");
    $("log").textContent = log;
    const link = $("file") as HTMLAnchorElement;
    link.href = resultLink(tc, walletId, path, verdict, log);
    link.hidden = false;
  } catch (e) {
    const message = (e as Error).message;
    const declined = (e as Error).name === "NotAllowedError";
    $("status").textContent = declined ? `The wallet declined or was closed: ${message}` : `Error: ${message}`;
    picker.setOutcome(declined ? { status: "declined" } : { status: "error", message });
    const log = `Testing EHR run ${started}\nScenario ${tc.id}; wallet ${walletId}; path ${path}\n${declined ? "DECLINED" : "ERROR"}: ${message}`;
    $("log").textContent = log;
    const link = $("file") as HTMLAnchorElement;
    link.href = resultLink(tc, walletId, path, declined ? "blocked" : "fail", log);
    link.hidden = false;
  }
}

picker.strings = {
  doneTitle: "Response received from {name}",
  doneDetail: "Every check passed. See them below.",
  shareAgain: "Send again or pick another wallet",
  declinedDetail: "{name} declined or was closed before answering.",
};
load().catch((e) => { $("status").textContent = `Could not load the catalog or registry: ${(e as Error).message}`; });
