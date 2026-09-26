/**
 * Builds the connectathon site into _site/, and fails on anything invalid.
 *
 *   bun scripts/build.ts              validate and build
 *   bun scripts/build.ts --check-only validate only (used on pull requests)
 *
 * Inputs (all in this repo):
 *   scenarios.md                           rendered to an HTML page
 *   participants/*.json                    validated; web wallets become wallets.json
 *   requests/*.json                        validated as SMART requests
 *   Questionnaire/*.json                   validated as Questionnaires hosted at their url
 *   catalog.json                           test cases, cross-checked against requests
 *   testing-ehr/, testing-wallet/          bundled with Bun
 * Result issues (label "result") are read from GitHub when a token is available.
 */
import { Marked } from "marked";
import { gfmHeadingId } from "marked-gfm-heading-id";
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

function page(title: string, body: string, { wide = false } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/assets/smart-design.css">
<link rel="stylesheet" href="${SITE}site.css">
<script src="/assets/site-chrome.js" defer></script>
</head>
<body>
<div data-smart-topbar></div>
<main class="page${wide ? " wide" : ""}">
<p class="crumbs"><a href="${SITE}">Connectathon</a> · <a href="${SITE}requests/">Requests</a> · <a href="${SITE}Questionnaire/">Questionnaires</a> · <a href="${SITE}directory.html">Directory</a> · <a href="${SITE}register/">Register</a> · <a href="${SITE}results.html">Results</a> · <a href="https://github.com/${REPO}">GitHub</a></p>
${body}
</main>
<div data-smart-footer></div>
</body>
</html>
`;
}

function renderMarkdownPage(src: string, out: string, fallbackTitle: string) {
  const md = readFileSync(join(ROOT, src), "utf8");
  const title = md.match(/^# (.+)$/m)?.[1] ?? fallbackTitle;
  writeFileSync(join(OUT, out), page(title, `<article class="doc">${marked.parse(md)}</article>`));
}

cpSync(join(ROOT, "site.css"), join(OUT, "site.css"));
// This section's menu, read by the site chrome.
cpSync(join(ROOT, "nav.json"), join(OUT, "nav.json"));
cpSync(join(ROOT, "icons"), join(OUT, "icons"), { recursive: true });
renderMarkdownPage("scenarios.md", "index.html", "SMART Health Check-in connectathon");

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
writeFileSync(join(OUT, "requests/index.html"), page("Connectathon requests", `<article class="doc">${reqReadme}</article>${reqRows}`));

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
    "Connectathon questionnaires",
    `<article class="doc"><h1>Example questionnaires</h1><p>FHIR R4 Questionnaires for the connectathon. Each one's <code>url</code> is the address it is served from, so a wallet can fetch it by reference.</p></article>
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
    dirRows += `<tr><td>${p.homepage ? `<a href="${esc(p.homepage)}">${esc(p.organization)}</a>` : esc(p.organization)}</td><td>${roleName[c.role]}${c.platforms ? ` (${esc(c.platforms.join(", "))})` : ""}</td><td><b>${esc(c.name)}</b>${c.description ? `<br><span class="muted">${esc(c.description)}</span>` : ""}<br><code>${esc(c.id)}</code></td><td>${link ? `<a href="${esc(link)}">${c.role === "native-wallet" ? "Install" : "Open"}</a>` : ""}</td><td>${esc(c.testPatient ?? "")}</td><td>${statusPill(c.status)}</td><td>${contacts}</td></tr>`;
  }
}
writeFileSync(
  join(OUT, "directory.html"),
  page(
    "Connectathon directory",
    `<article class="doc"><h1>Participant directory</h1><p>Every component registered for the connectathon, generated from the <a href="https://github.com/${REPO}/tree/main/participants">participant files</a>. To add or change yours, use the <a href="register/">registration form</a>. Web wallets listed here are in the <a href="wallets.json">wallet registry</a>.</p></article>
<div class="table-wrap"><table><thead><tr><th>Organization</th><th>Role</th><th>Component</th><th>Link</th><th>Test patient</th><th>Status</th><th>Contacts</th></tr></thead><tbody>${dirRows}</tbody></table></div>`,
    { wide: true },
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
    "Connectathon results",
    `<article class="doc"><h1>Test results</h1><p>The latest open result for each scenario and EHR and wallet pair, from the <a href="https://github.com/${REPO}/issues?q=label%3Aresult">result issues</a>. <a href="https://github.com/${REPO}/issues/new?template=test-result.yml">File a result</a>. Close an issue to withdraw its result. Rebuilt whenever a result issue changes.</p></article>${resultsBody}`,
    { wide: true },
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
  // Static files the tool fetches at run time.
  for (const extra of ["data", "issuer", "FEATURES.md"]) {
    if (existsSync(join(dir, extra))) cpSync(join(dir, extra), join(OUT, tool, extra), { recursive: true });
  }
}

console.log(`built ${OUT}`);
