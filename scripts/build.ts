/**
 * Builds the connectathon site into _site/, and fails on anything invalid.
 *
 *   bun scripts/build.ts              validate and build
 *   bun scripts/build.ts --check-only validate only (used on pull requests)
 *
 * Inputs (all in this repo):
 *   index.md, the per-type pages, scenarios.md   rendered to HTML pages
 *   participants/*.json                    validated; web wallets become wallets.json
 *   requests/*.json                        validated as SMART requests
 *   Questionnaire/*.json                   validated as Questionnaires hosted at their url
 *   catalog.json                           test cases, cross-checked against requests
 *   testing-ehr/, testing-wallet/          bundled with Bun
 * Result issues (label "result") are read from GitHub when a token is available.
 */
import { Marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
import { FORM_URL, PROMPTS } from "./links.ts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateSmartCheckinRequest, validateWalletRegistry } from "@smart-health-checkin/client/model";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OUT = join(ROOT, "_site");
const SITE = "https://smart-health-checkin.org/connectathon/";
const REPO = "smart-health-checkin/connectathon";
const DEMO_EHR = "https://smart-health-checkin.org/client/demo/";
const CHECK_ONLY = process.argv.includes("--check-only");

// Requests that are meant to fail the request validator, with the reason.
const EXPECTED_INVALID: Record<string, string> = {};

const errors: string[] = [];
const fail = (msg: string) => errors.push(msg);
const readJson = (path: string): any => {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    fail(`${path}: not valid JSON (${(e as Error).message})`);
    return undefined;
  }
};
const jsonFiles = (dir: string) =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir)).filter((f) => f.endsWith(".json")).sort()
    : [];

// ---------------------------------------------------------------- participants
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const participantSchema = readJson(join(ROOT, "participants/schema.json"));
const validateParticipant = ajv.compile(participantSchema);

type Component = {
  id: string; role: "ehr" | "web-wallet" | "native-wallet"; name: string; status: string;
  description?: string; url?: string; walletUrl?: string; iconUrl?: string; target?: "tab" | "popup";
  installUrl?: string; platforms?: string[]; testPatient?: string; notes?: string; homepage?: string;
};
type Participant = { file: string; organization: string; homepage?: string; contacts?: any[]; components: Component[] };

const participants: Participant[] = [];
const componentIds = new Map<string, string>();
for (const file of jsonFiles("participants").filter((f) => f !== "schema.json")) {
  const path = `participants/${file}`;
  const data = readJson(join(ROOT, path)) as any;
  if (!data) continue;
  if (!validateParticipant(data)) {
    for (const e of validateParticipant.errors ?? []) fail(`${path}${e.instancePath}: ${e.message}`);
    continue;
  }
  for (const c of (data as any).components as Component[]) {
    if (componentIds.has(c.id)) fail(`${path}: component id "${c.id}" is already used in ${componentIds.get(c.id)}`);
    componentIds.set(c.id, path);
    for (const key of ["url", "walletUrl", "installUrl", "iconUrl", "homepage"] as const) {
      const v = c[key];
      if (v && !v.startsWith("https://")) fail(`${path}: ${c.id}.${key} must be an https URL`);
    }
  }
  participants.push({ file, ...(data as any) });
}

// ---------------------------------------------------------------- wallet registry
// Icons are inlined as data: URLs, so an EHR page showing the registry contacts
// no wallet's server until the patient picks that wallet. An icon that can't be
// fetched or fails the checks is dropped with a warning; it never blocks a deploy.
const ICON_MAX_BYTES = 64 * 1024;
const ICON_TYPES = ["image/svg+xml", "image/png", "image/webp", "image/jpeg"];
async function inlineIcon(url: string, who: string): Promise<string | undefined> {
  if (url.startsWith("data:")) return url;
  try {
    let bytes: Uint8Array, type: string;
    if (url.startsWith(SITE)) {
      const local = join(ROOT, url.slice(SITE.length));
      bytes = readFileSync(local);
      type = local.endsWith(".svg") ? "image/svg+xml" : local.endsWith(".png") ? "image/png" : "";
    } else {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      bytes = new Uint8Array(await res.arrayBuffer());
    }
    if (!ICON_TYPES.includes(type)) throw new Error(`type ${type || "unknown"} is not one of ${ICON_TYPES.join(", ")}`);
    if (bytes.length > ICON_MAX_BYTES) throw new Error(`${bytes.length} bytes, over the ${ICON_MAX_BYTES}-byte limit`);
    if (type === "image/svg+xml") {
      const svg = new TextDecoder().decode(bytes);
      if (/<script|<foreignObject|\son\w+\s*=|javascript:|(?:xlink:)?href\s*=\s*["'](?!#)/i.test(svg)) {
        throw new Error("SVG contains scripts, event handlers, or external references");
      }
      return "data:image/svg+xml," + encodeURIComponent(svg.trim());
    }
    return `data:${type};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (e) {
    console.warn(`warning: ${who}: icon ${url} left out: ${(e as Error).message}`);
    return undefined;
  }
}

const webWallets = await Promise.all(participants.flatMap((p) =>
  p.components
    .filter((c) => c.role === "web-wallet")
    .map(async (c) => {
      const icon = c.iconUrl ? await inlineIcon(c.iconUrl, `${p.file} ${c.id}`) : undefined;
      return {
        id: c.id,
        name: c.name,
        walletUrl: c.walletUrl!,
        description: [c.description, c.testPatient ? `Test patient: ${c.testPatient}.` : "", `From ${p.organization}.`]
          .filter(Boolean)
          .join(" "),
        ...(c.homepage ?? p.homepage ? { homepage: c.homepage ?? p.homepage } : {}),
        ...(icon ? { iconUrl: icon } : {}),
        target: c.target ?? "tab",
      };
    }),
));
// The SMART Testing Wallet is the known-good reference, so it's listed first.
const FIRST_WALLET = "smart-testing-wallet";
webWallets.sort((a, b) => Number(b.id === FIRST_WALLET) - Number(a.id === FIRST_WALLET));
const registry = { source: "KTC SMART Health Check-in connectathon registry", wallets: webWallets };
const registryCheck = validateWalletRegistry(registry);
if (!registryCheck.ok) fail(`generated wallets.json is invalid: ${registryCheck.error}`);

// ---------------------------------------------------------------- questionnaires
const questionnaires: { file: string; q: any }[] = [];
for (const file of jsonFiles("Questionnaire")) {
  const path = `Questionnaire/${file}`;
  const q = readJson(join(ROOT, path));
  if (!q) continue;
  if (q.resourceType !== "Questionnaire") fail(`${path}: resourceType must be Questionnaire`);
  if (q.url !== `${SITE}Questionnaire/${file}`) fail(`${path}: url must be ${SITE}Questionnaire/${file}`);
  if (!q.status) fail(`${path}: status is required`);
  const linkIds = new Set<string>();
  const walk = (items: any[] = []) => {
    for (const item of items) {
      if (!item.linkId) fail(`${path}: an item has no linkId`);
      if (linkIds.has(item.linkId)) fail(`${path}: duplicate linkId ${item.linkId}`);
      linkIds.add(item.linkId);
      if (!item.type) fail(`${path}: item ${item.linkId} has no type`);
      walk(item.item);
    }
  };
  walk(q.item);
  const checkEnableWhen = (items: any[] = []) => {
    for (const item of items) {
      for (const ew of item.enableWhen ?? [])
        if (!linkIds.has(ew.question)) fail(`${path}: ${item.linkId} enableWhen points at unknown ${ew.question}`);
      checkEnableWhen(item.item);
    }
  };
  checkEnableWhen(q.item);
  questionnaires.push({ file, q });
}

// ---------------------------------------------------------------- requests
const requests: { file: string; request: any; valid: boolean }[] = [];
for (const file of jsonFiles("requests")) {
  const path = `requests/${file}`;
  const request = readJson(join(ROOT, path));
  if (!request) continue;
  const result = validateSmartCheckinRequest(request);
  if (EXPECTED_INVALID[file]) {
    if (result.ok) fail(`${path}: expected to fail validation (${EXPECTED_INVALID[file]}) but passed`);
  } else if (!result.ok) {
    fail(`${path}: ${result.error}`);
  }
  // Inline questionnaires must match the hosted copy exactly.
  for (const item of request.items ?? []) {
    const c = item.content ?? {};
    if (c.kind === "form.fhir" && c.questionnaire?.url) {
      const hosted = questionnaires.find((x) => x.q.url === c.questionnaire.url);
      if (!hosted) fail(`${path}: inline questionnaire ${c.questionnaire.url} is not hosted in Questionnaire/`);
      else if (JSON.stringify(hosted.q) !== JSON.stringify(c.questionnaire))
        fail(`${path}: inline questionnaire differs from Questionnaire/${hosted.file}; regenerate the request`);
    }
    if (c.kind === "form.fhir" && c.questionnaireCanonical) {
      const base = String(c.questionnaireCanonical).split("|")[0];
      if (base.startsWith(SITE) && !questionnaires.some((x) => x.q.url === base))
        fail(`${path}: questionnaireCanonical ${base} is not hosted in Questionnaire/`);
    }
  }
  requests.push({ file, request, valid: !EXPECTED_INVALID[file] });
}

// ---------------------------------------------------------------- catalog
const catalog = existsSync(join(ROOT, "catalog.json")) ? readJson(join(ROOT, "catalog.json")) : undefined;
if (catalog) {
  const ids = new Set<string>();
  for (const tc of catalog.testCases ?? []) {
    if (ids.has(tc.id)) fail(`catalog.json: duplicate test case ${tc.id}`);
    ids.add(tc.id);
    if (tc.request && !requests.some((r) => r.file === tc.request))
      fail(`catalog.json: ${tc.id} points at missing request ${tc.request}`);
  }
}

// ---------------------------------------------------------------- page sources
// The Markdown pages may hold {{TBD: …}} (rendered as "To be announced"); nothing else in {{…}}.
const PAGES = ["index.md", "patients.md", "clinic-staff.md", "verifier-developers.md", "wallet-developers.md", "observers.md", "scenarios.md", "requests/README.md"];
for (const src of PAGES) {
  if (!existsSync(join(ROOT, src))) continue;
  const left = readFileSync(join(ROOT, src), "utf8").replace(/\{\{TBD:[^}]*\}\}/g, "");
  if (left.includes("{{")) fail(`${src}: stray {{ (only {{TBD: …}} is allowed in pages)`);
}

// ---------------------------------------------------------------- stop on errors
if (errors.length) {
  console.error(`Build failed with ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log(
  `ok: ${participants.length} participant file(s), ${webWallets.length} web wallet(s), ` +
    `${requests.length} request(s), ${questionnaires.length} questionnaire(s)` +
    (catalog ? `, ${catalog.testCases.length} test case(s)` : ""),
);
if (CHECK_ONLY) process.exit(0);

// ---------------------------------------------------------------- render
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const marked = new Marked();
marked.use(gfmHeadingId());

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

// The shared site chrome (bar, breadcrumb, footer, fonts), served by the apex site.
const CHROME_HEAD = `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="/assets/smart-design.css">
<script src="/assets/site-chrome.js" defer></script>`;

/** Keeps "Check-in" from breaking at its hyphen in headings and cards. */
const noBreakCheckIn = (html: string) =>
  html.replace(/(<(h[1-6]|b)\b[^>]*>)([\s\S]*?)(<\/\2>)/g, (_m, open, _tag, inner, close) =>
    open + inner.replace(/(^|>)([^<]*)/g, (_x: string, gt: string, text: string) => gt + text.replace(/\b(Check)-(in)\b/g, '<span class="nw">$1-$2</span>')) + close);

/** A content page. The breadcrumb comes from nav.json; it's hidden on the front page. */
function page(title: string, body: string, { front = false } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(front ? title : `${title} · Connectathon`)}</title>
${CHROME_HEAD}
<link rel="stylesheet" href="/connectathon/site.css">
</head>
<body>
<div data-smart-topbar></div>
<nav data-smart-breadcrumb${front ? " hidden" : ""}></nav>
<main id="main" class="page">
${noBreakCheckIn(body)}
</main>
<div data-smart-footer></div>
</body>
</html>
`;
}

// Event details not yet decided are written {{TBD: what}} in the Markdown and shown as a pill.
// Any other {{…}} left in a published page fails the build (checked after rendering).
const tbd = (md: string) =>
  md.replace(/\{\{TBD:\s*([^}]*)\}\}/g, (_m, what) => `<span class="tbd" title="${esc(what.trim())}">To be announced</span>`);

/** The "Share your experience" page: prompts to copy into any AI assistant, and the form. */
function sharePage(prompts: Array<{ file: string; title: string; who: string; what: string; text: string }>): string {
  // Deep links carry the prompt only when it fits comfortably in a URL; otherwise they open a
  // new chat and the page asks the person to paste what the button copied. Claude documents
  // truncation around 14,000 characters; 12,000 leaves headroom. Both sites prefill without sending.
  const MAX_URL = 12000;
  const deep = (base: string, text: string) => {
    const url = base + encodeURIComponent(text);
    return url.length <= MAX_URL ? { url, prefilled: true } : { url: base.replace(/[?&]q=$/, ""), prefilled: false };
  };
  const data = prompts.map((pr) => ({
    id: pr.file.replace(/\.md$/, ""),
    text: pr.text,
    claude: deep("https://claude.ai/new?q=", pr.text),
    chatgpt: deep("https://chatgpt.com/?q=", pr.text),
  }));
  // One prompt's buttons; a track can show the same prompt as another track.
  const card = (i: number) => `
<div class="prompt-card" data-prompt="${esc(data[i]!.id)}">
  <p><b>Prompt: ${esc(prompts[i]!.title)}</b></p>
  <div class="prompt-actions">
    <button type="button" class="smart-btn primary" data-act="copy">Copy the whole prompt</button>
    <button type="button" class="smart-btn" data-act="claude">Open in Claude</button>
    <button type="button" class="smart-btn" data-act="chatgpt">Open in ChatGPT</button>
    <a href="prompts/${esc(prompts[i]!.file)}">View as text</a>
  </div>
  <p class="prompt-status" role="status"></p>
</div>`;
  const patient = prompts.findIndex((pr) => pr.file === "try-it-as-a-patient.md");
  const debrief = prompts.findIndex((pr) => pr.file === "debrief.md");
  const form = `<a href="${esc(FORM_URL)}">experience form</a>`;
  return `<article class="doc share">
<h1>Share your experience</h1>
<p>We want to hear how SMART Health Check-in worked for you: what was easy, what was confusing, and what would make you trust it. Pick your track below. Each one ends with a short report you send through the ${form}.</p>
<div id="context" class="context-note" hidden>
  <p><b>Your last try:</b> <span id="context-text"></span></p>
  <button type="button" class="smart-btn" id="copy-context">Copy this note</button>
  <span class="prompt-status" id="context-status" role="status"></span>
</div>
<h2 id="which">Which one is for you?</h2>
<a id="ai-guide"></a>
<ul class="tracks">
  <li><a href="#patients">Patients and community members</a>: try the demos with an AI guide, then send what you found.</li>
  <li><a href="#clinic-staff">Clinic and front-desk staff</a>: the same demos, from the front desk's point of view.</li>
  <li><a href="#developers">Verifier and wallet developers</a>: debrief your testing with an AI assistant, and record formal scenario runs.</li>
  <li><a href="#observers">Observers</a>: tell us what you noticed.</li>
</ul>
<p>The prompts work in any AI assistant: copy one and paste it into Claude, ChatGPT, Gemini, Copilot, or whatever you use. The Open buttons copy the prompt and start a new chat with it filled in; if the chat is empty, paste it (Ctrl+V or ⌘V, or press and hold on a phone). Claude shows a caution banner for any prompt opened from a link; that's expected here.</p>

<section class="track" id="patients">
<h2>Patients and community members</h2>
<ol>
  <li><b>Start the guide.</b> Copy the patient guide prompt, or open it in an assistant:${card(patient)}</li>
  <li><b>Follow it.</b> It walks you through three short demos, about 15 minutes, and asks how each one went.</li>
  <li><b>Send your report.</b> Paste the report it drafts into the ${form}. You don't need an account.</li>
</ol>
</section>

<section class="track" id="clinic-staff">
<h2>Clinic and front-desk staff</h2>
<ol>
  <li><b>Start the guide.</b> The patient guide works from the front desk too: paste it, then tell the assistant you work at a front desk. It takes you through the same demos, including the kiosk.${card(patient)}</li>
  <li><b>Follow it,</b> and say what would and wouldn't fit your front desk.</li>
  <li><b>Send your report</b> through the ${form}. Or skip the guide and write a few sentences in your own words.</li>
</ol>
</section>

<section class="track" id="developers">
<h2>Verifier and wallet developers</h2>
<ol>
  <li><b>Start the debrief.</b> Copy the debrief prompt, or open it in an assistant:${card(debrief)}</li>
  <li><b>Answer its questions.</b> Paste in your notes, logs, or Testing EHR runs. It asks what worked, what was hard, and where the spec or tools fell short, then drafts a short report.</li>
  <li><b>Send your report</b> through the ${form}.</li>
  <li><b>Formal scenario runs:</b> also record each one as a <a href="https://github.com/${REPO}/issues/new?template=test-result.yml">structured result</a>. They're collected on the <a href="results.html">results page</a>.</li>
</ol>
</section>

<section class="track" id="observers">
<h2>Observers</h2>
<ol>
  <li><b>Try it, if you like.</b> The <a href="#patients">patient track</a> takes about 15 minutes on any phone or computer.</li>
  <li><b>Send what you noticed</b> through the ${form}: a few sentences in your own words is plenty.</li>
</ol>
</section>

<h2 id="send-your-report">About the form</h2>
<p>The ${form} asks which describes you, your name and organization (optional), an email if we may follow up (optional), and your report. You don't need an account.</p>
<p>Reports are public: we may publish them on this site and in summaries, credited with the name and organization you give, or anonymously if you leave those blank. Your email address is never published. Leave out anything you wouldn't want public.</p>
</article>
<script type="application/json" id="prompt-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script>
(() => {
  const prompts = JSON.parse(document.getElementById("prompt-data").textContent);
  const byId = Object.fromEntries(prompts.map((p) => [p.id, p]));
  // Copy synchronously inside the click where possible (Safari drops permission after an await).
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.append(ta); ta.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch {}
    ta.remove(); return ok;
  }
  for (const card of document.querySelectorAll(".prompt-card")) {
    const p = byId[card.dataset.prompt];
    const status = card.querySelector(".prompt-status");
    card.addEventListener("click", async (e) => {
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (!act) return;
      const link = act === "claude" ? p.claude : act === "chatgpt" ? p.chatgpt : null;
      // Start the copy first, while this page still has focus, then open the chat.
      const copying = copy(p.text);
      let opened = null;
      if (link) { opened = window.open(link.url, "_blank"); if (opened) opened.opener = null; }
      const ok = await copying;
      if (!link) status.textContent = ok ? "Copied. Paste it into any AI assistant to start." : "Couldn't copy automatically. Open View as text and copy it from there.";
      else if (link.prefilled) status.textContent = "Opened a new chat with the prompt filled in. If it's empty, paste it: it's copied.";
      else status.textContent = ok ? "Copied, and opened a new chat. Paste the prompt there to start." : "Opened a new chat. Copy the prompt from View as text and paste it there.";
      if (link && !opened) status.textContent += " (If no new tab opened, your browser may have blocked it.)";
    });
  }
  // A note from the app that sent you here, to paste into the chat or the form.
  const h = new URLSearchParams(location.hash.slice(1));
  const from = h.get("from");
  if (from) {
    const names = { "clinic-demo": "the clinic check-in demo", "demo-wallet": "the Demo wallet", "autofill-demo": "the allergy autofill demo", "kiosk-demo": "the kiosk demo", "testing-ehr": "the SMART Testing EHR", "testing-wallet": "the SMART Testing Wallet" };
    const when = h.get("time") ? new Date(h.get("time")) : null;
    const note = "I just tried " + (names[from] || from) + (h.get("result") ? " (outcome: " + h.get("result") + ")" : "") +
      (when && !isNaN(when) ? " at " + when.toLocaleString() : "") + ".";
    document.getElementById("context-text").textContent = note;
    const ctx = document.getElementById("context");
    ctx.hidden = false;
    // Put the note in the track for the app they came from, and go there.
    const track = { "testing-ehr": "developers", "testing-wallet": "developers" }[from] || "patients";
    const section = document.getElementById(track);
    if (section) {
      section.querySelector("h2").after(ctx);
      section.classList.add("current");
      section.scrollIntoView({ block: "start" });
    }
    document.getElementById("copy-context").onclick = async () => {
      document.getElementById("context-status").textContent = (await copy(note)) ? "Copied." : "Couldn't copy; select the text instead.";
    };
  }
})();
</script>`;
}

function renderMarkdownPage(src: string, out: string, fallbackTitle: string) {
  const md = tbd(readFileSync(join(ROOT, src), "utf8"));
  const title = md.match(/^# (.+)$/m)?.[1] ?? fallbackTitle;
  writeFileSync(join(OUT, out), page(title, `<article class="doc">${marked.parse(md)}</article>`, { front: out === "index.html" }));
}

cpSync(join(ROOT, "site.css"), join(OUT, "site.css"));
// This section's menu, read by the site chrome.
cpSync(join(ROOT, "nav.json"), join(OUT, "nav.json"));
cpSync(join(ROOT, "icons"), join(OUT, "icons"), { recursive: true });
// The front page is a hub; each participant type has its own page.
renderMarkdownPage("index.md", "index.html", "SMART Health Check-in connectathon");
renderMarkdownPage("patients.md", "patients.html", "Patients and community");
renderMarkdownPage("clinic-staff.md", "clinic-staff.html", "Clinic staff");
renderMarkdownPage("verifier-developers.md", "verifier-developers.html", "Verifier developers");
renderMarkdownPage("wallet-developers.md", "wallet-developers.html", "Wallet developers");
renderMarkdownPage("observers.md", "observers.html", "Observers");
renderMarkdownPage("scenarios.md", "scenarios.html", "Test scenarios");

// Prompts people paste into an AI assistant, and the page that offers them.
mkdirSync(join(OUT, "prompts"), { recursive: true });
const promptTexts = PROMPTS.map((pr) => {
  const text = readFileSync(join(ROOT, "prompts", pr.file), "utf8").replaceAll("{{FORM_URL}}", FORM_URL);
  if (text.includes("{{")) throw new Error(`prompts/${pr.file}: unfilled placeholder`);
  writeFileSync(join(OUT, "prompts", pr.file), text);
  return { ...pr, text };
});
writeFileSync(join(OUT, "share.html"), page("Share your experience", sharePage(promptTexts)));

// wallets.json
writeFileSync(join(OUT, "wallets.json"), JSON.stringify(registry, null, 2) + "\n");
// components.json: every component with the label the result form uses, for the test tools.
writeFileSync(
  join(OUT, "components.json"),
  JSON.stringify(
    participants.flatMap((p) => p.components.map((c) => ({ id: c.id, role: c.role, organization: p.organization, name: c.name, label: `${c.name} (${p.organization}, ${c.id})` }))),
    null,
    2,
  ) + "\n",
);

// sample responses, raw
if (existsSync(join(ROOT, "responses"))) cpSync(join(ROOT, "responses"), join(OUT, "responses"), { recursive: true });

// participants and schema, raw, plus an index for the registration form
mkdirSync(join(OUT, "participants"), { recursive: true });
cpSync(join(ROOT, "participants"), join(OUT, "participants"), { recursive: true });
writeFileSync(join(OUT, "participants/index.json"), JSON.stringify(participants.map((p) => ({ file: p.file, organization: p.organization })), null, 2) + "\n");
if (catalog) writeFileSync(join(OUT, "catalog.json"), JSON.stringify(catalog, null, 2) + "\n");

// requests: raw files plus an index with "try it" links
const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const registryUrl = `${SITE}wallets.json`;
mkdirSync(join(OUT, "requests"), { recursive: true });
const describe = (r: any) =>
  (r.items ?? [])
    .map((i: any) => {
      const c = i.content ?? {};
      const what =
        c.kind === "form.fhir"
          ? `form ${c.questionnaire ? "inline" : "by reference"}: ${esc(String(c.questionnaireCanonical ?? "").replace(SITE, ""))}`
          : c.kind === "selection.fhir"
            ? [
                ...(c.profiles ?? []).map((p: string) => p.split("/").pop()),
                ...(c.profilesFrom ?? []).map((p: string) => `any of ${p}`),
                ...(c.resourceTypes ?? []).map((t: string) => `type ${t}`),
              ].join(", ") || "no selector"
            : `unknown kind ${esc(c.kind)}`;
      return `<li><code>${esc(i.id)}</code> ${esc(i.title)} <span class="muted">(${what}; accepts ${esc((i.accept ?? []).join(", "))})</span></li>`;
    })
    .join("");
let reqRows = "";
for (const { file, request, valid } of requests) {
  writeFileSync(join(OUT, "requests", file), JSON.stringify(request, null, 2) + "\n");
  const tryIt = valid
    ? `<a href="${DEMO_EHR}#request=${b64url(JSON.stringify(request))}&amp;wallets=${encodeURIComponent(registryUrl)}">Try in the reference EHR</a>`
    : `<span class="muted">Not sendable by the client library: it ${esc(EXPECTED_INVALID[file])}. Use the testing EHR.</span>`;
  reqRows += `<section class="req"><h2 id="${esc(file.replace(/\.json$/, ""))}"><a href="${file}">${esc(file)}</a></h2><ul>${describe(request)}</ul><p>${tryIt}</p></section>`;
}
const reqReadme = existsSync(join(ROOT, "requests/README.md"))
  ? marked.parse(readFileSync(join(ROOT, "requests/README.md"), "utf8"))
  : "<h1>Requests</h1>";
writeFileSync(join(OUT, "requests/index.html"), page("Requests", `<article class="doc">${reqReadme}</article>${reqRows}`));

// questionnaires: raw files plus an index
mkdirSync(join(OUT, "Questionnaire"), { recursive: true });
let qRows = "";
for (const { file, q } of questionnaires) {
  writeFileSync(join(OUT, "Questionnaire", file), JSON.stringify(q, null, 2) + "\n");
  const count = (items: any[] = []): number =>
    items.reduce((n, i) => n + (i.type === "display" || i.type === "group" ? 0 : 1) + count(i.item), 0);
  const types = new Set<string>();
  const collect = (items: any[] = []) => items.forEach((i) => { types.add(i.type + (i.repeats ? " (repeats)" : "")); collect(i.item); });
  collect(q.item);
  qRows += `<tr><td><a href="${file}">${esc(q.title)}</a></td><td class="num">${count(q.item)}</td><td>${esc([...types].sort().join(", "))}</td><td><code>${esc(q.url)}</code></td></tr>`;
}
writeFileSync(
  join(OUT, "Questionnaire/index.html"),
  page(
    "Questionnaires",
    `<article class="doc"><h1>Questionnaires</h1><p>FHIR R4 Questionnaires for the connectathon. Each one's <code>url</code> is the address it is served from, so a wallet can fetch it by reference.</p></article>
<div class="table-wrap"><table><thead><tr><th>Form</th><th>Questions</th><th>Item types</th><th>Canonical</th></tr></thead><tbody>${qRows}</tbody></table></div>`,
  ),
);

// directory
const statusPill = (s: string) => `<span class="pill ${esc(s)}">${esc({ up: "Up", "not-yet": "Not yet", broken: "Broken" }[s] ?? s)}</span>`;
const roleName = { ehr: "EHR", "web-wallet": "Web wallet", "native-wallet": "Native wallet" } as const;
let dirRows = "";
for (const p of participants) {
  for (const c of p.components) {
    const link = c.url ?? c.walletUrl ?? c.installUrl;
    const contacts = (p.contacts ?? [])
      .map((x: any) => [esc(x.name), x.github ? `<a href="https://github.com/${esc(x.github)}">@${esc(x.github)}</a>` : "", x.slack ? `Slack: ${esc(x.slack)}` : "", x.email ? esc(x.email) : ""].filter(Boolean).join(" · "))
      .join("<br>");
    const org = p.homepage ? `<a href="${esc(p.homepage)}">${esc(p.organization)}</a>` : esc(p.organization);
    dirRows += `<tr><td class="d-org">${org}</td>` +
      `<td class="d-role">${roleName[c.role]}${c.platforms ? ` (${esc(c.platforms.join(", "))})` : ""}</td>` +
      `<td class="d-comp"><b>${esc(c.name)}</b>${c.description ? `<br><span class="muted">${esc(c.description)}</span>` : ""}<br><code>${esc(c.id)}</code></td>` +
      `<td class="d-link">${link ? `<a class="open" href="${esc(link)}">${c.role === "native-wallet" ? "Install" : "Open"}</a>` : ""}</td>` +
      `<td class="d-patient" data-label="Test patient">${esc(c.testPatient ?? "")}</td>` +
      `<td class="d-status">${statusPill(c.status)}</td>` +
      `<td class="d-contacts" data-label="Contacts">${contacts}</td></tr>`;
  }
}
writeFileSync(
  join(OUT, "directory.html"),
  page(
    "Directory",
    `<article class="doc"><h1>Directory</h1><p>Every component registered for the connectathon, generated from the <a href="https://github.com/${REPO}/tree/main/participants">participant files</a>. To add or change yours, use the <a href="register/">registration form</a>. Web wallets listed here are in the <a href="wallets.json">wallet registry</a>.</p></article>
<div class="table-wrap"><table class="directory"><thead><tr><th>Organization</th><th>Role</th><th>Component</th><th>Link</th><th>Test patient</th><th>Status</th><th>Contacts</th></tr></thead><tbody>${dirRows}</tbody></table></div>`,
  ),
);

// results, from GitHub issues labeled "result"
type Result = { number: number; url: string; state: string; created: string; fields: Record<string, string> };
async function fetchResults(): Promise<Result[] | undefined> {
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const out: Result[] = [];
  try {
    for (let pageNo = 1; pageNo < 20; pageNo++) {
      const res = await fetch(`https://api.github.com/repos/${REPO}/issues?labels=result&state=all&per_page=100&page=${pageNo}`, { headers });
      if (!res.ok) return undefined;
      const batch = (await res.json()) as any[];
      for (const issue of batch) {
        if (issue.pull_request) continue;
        out.push({ number: issue.number, url: issue.html_url, state: issue.state, created: issue.created_at, fields: parseIssueForm(issue.body ?? "") });
      }
      if (batch.length < 100) break;
    }
    return out;
  } catch {
    return undefined;
  }
}
// Issue forms render as "### Label\n\nvalue" blocks.
function parseIssueForm(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const parts = body.split(/^### /m).slice(1);
  for (const part of parts) {
    const [label, ...rest] = part.split("\n");
    fields[label.trim()] = rest.join("\n").trim().replace(/^_No response_$/, "");
  }
  return fields;
}
const results = await fetchResults();
let resultsBody: string;
if (!results) {
  resultsBody = `<p class="muted">Results could not be loaded at build time. See the <a href="https://github.com/${REPO}/issues?q=label%3Aresult">result issues</a> directly.</p>`;
} else if (results.length === 0) {
  resultsBody = `<p>No results filed yet.</p>`;
} else {
  // Latest open result per scenario, EHR, wallet, and path.
  const latest = new Map<string, Result>();
  for (const r of [...results].sort((a, b) => a.created.localeCompare(b.created))) {
    if (r.state !== "open") continue;
    const f = r.fields;
    latest.set([f["Scenario"], f["EHR"], f["Wallet"], f["Path"]].join("|"), r);
  }
  const byScenario = new Map<string, Result[]>();
  for (const r of latest.values()) {
    const s = r.fields["Scenario"] || "(no scenario)";
    byScenario.set(s, [...(byScenario.get(s) ?? []), r]);
  }
  const cls = (v: string) => (/^pass/i.test(v) ? "up" : /^fail/i.test(v) ? "broken" : "not-yet");
  resultsBody = byScenario.size === 0 ? `<p>No open results. Closed issues are withdrawn results.</p>` : [...byScenario.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([scenario, rs]) => {
      const ehrs = [...new Set(rs.map((r) => r.fields["EHR"]))].sort();
      const wallets = [...new Set(rs.map((r) => `${r.fields["Wallet"]} (${r.fields["Path"]})`))].sort();
      const cell = (e: string, w: string) => {
        const r = rs.find((x) => x.fields["EHR"] === e && `${x.fields["Wallet"]} (${x.fields["Path"]})` === w);
        return r ? `<td><a class="pill ${cls(r.fields["Result"])}" href="${r.url}">${esc(r.fields["Result"] || "?")} #${r.number}</a></td>` : "<td></td>";
      };
      return `<h2>${esc(scenario)}</h2><div class="table-wrap"><table><thead><tr><th>EHR \\ wallet</th>${wallets.map((w) => `<th>${esc(w)}</th>`).join("")}</tr></thead><tbody>${ehrs.map((e) => `<tr><th>${esc(e)}</th>${wallets.map((w) => cell(e, w)).join("")}</tr>`).join("")}</tbody></table></div>`;
    })
    .join("");
}
writeFileSync(
  join(OUT, "results.html"),
  page(
    "Results",
    `<article class="doc"><h1>Results</h1><p>The latest open result for each scenario and EHR and wallet pair, from the <a href="https://github.com/${REPO}/issues?q=label%3Aresult">result issues</a>. <a href="https://github.com/${REPO}/issues/new?template=test-result.yml">File a result</a>. Close an issue to withdraw its result. Rebuilt whenever a result issue changes.</p></article>${resultsBody}`,
  ),
);

// test tools, bundled
for (const tool of ["testing-ehr", "testing-wallet", "register"]) {
  const dir = join(ROOT, tool);
  if (!existsSync(join(dir, "index.html"))) continue;
  // The "bun" condition resolves the client library to its TypeScript source,
  // so the bundle doesn't depend on the package's dist/ having been built.
  const built = await Bun.build({ entrypoints: [join(dir, "index.html")], outdir: join(OUT, tool), minify: true, target: "browser", conditions: ["bun"] });
  if (!built.success) {
    for (const log of built.logs) console.error(log);
    process.exit(1);
  }
  // The shared chrome lives on the apex site, outside this bundle, so it's added after bundling,
  // ahead of the tool's own stylesheet.
  const html = join(OUT, tool, "index.html");
  const builtHtml = readFileSync(html, "utf8");
  if (!builtHtml.includes("</title>")) throw new Error(`${tool}/index.html: no <title> to put the site chrome after`);
  writeFileSync(html, builtHtml.replace("</title>", `</title>${CHROME_HEAD.replaceAll("\n", "")}`));
  // Static files the tool fetches at run time.
  for (const extra of ["data", "issuer", "FEATURES.md"]) {
    if (existsSync(join(dir, extra))) cpSync(join(dir, extra), join(OUT, tool, extra), { recursive: true });
  }
}

// No template markers in published pages: {{TBD: …}} becomes a pill and {{FORM_URL}} is filled in,
// so any other {{ is a mistake.
const htmlFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? htmlFiles(join(dir, e.name)) : e.name.endsWith(".html") ? [join(dir, e.name)] : []);
const stray = htmlFiles(OUT).filter((f) => readFileSync(f, "utf8").includes("{{"));
if (stray.length) {
  console.error(`Build failed: unfilled {{…}} in ${stray.map((f) => f.slice(OUT.length + 1)).join(", ")}`);
  process.exit(1);
}

console.log(`built ${OUT}`);
