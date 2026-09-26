// Registration form: builds participants/<org>.json and opens GitHub with it.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { ACCESS_LABEL, participantProblems, type Access, type Component, type Participant, type Role, type Validate } from "./participant.ts";
import { EXAMPLES } from "./examples.ts";
import { renderJson } from "../../shared/smart-json.ts";

const SITE = new URL("../", location.href).href;
const REPO = "smart-health-checkin/connectathon";

// In the form, a Verifier carries whether it runs as a web page or a phone app; the file doesn't store it.
type FormComponent = Component & { runsAs?: "page" | "app" };
type FormState = Omit<Participant, "components"> & { components: FormComponent[] };

const CARD_TITLE = (c: FormComponent) =>
  c.role === "verifier" ? (c.runsAs === "app" ? "Verifier: phone app" : "Verifier: web page") : c.role === "web-wallet" ? "Web wallet" : "Native wallet";
const VERIFIER_HINT = "A Verifier is the side that asks for data. EHR check-in pages, patient portals, kiosks, and clinic apps register as Verifiers.";
const appLike = (c: FormComponent) => c.role === "native-wallet" || (c.role === "verifier" && c.runsAs === "app");

type Kind = "text" | "url" | "textarea" | "status" | "target" | "platforms" | "access" | "runsAs" | "checkbox";
type Field = { key: keyof FormComponent; label: string; hint: string; required: boolean; kind: Kind };
const f = (key: keyof FormComponent, label: string, hint: string, required: boolean, kind: Kind): Field => ({ key, label, hint, required, kind });

function fieldsFor(c: FormComponent): Field[] {
  const head = [
    f("name", "Name", "As testers should see it.", true, "text"),
    f("id", "Short id", "Filled in from the name. Lowercase letters, digits, and hyphens, unique across all participants. Result reports use it, and a web wallet's short id is also its registry id.", true, "text"),
    ...(c.role === "verifier" ? [f("runsAs", "Runs as", "", true, "runsAs")] : []),
    f("description", "Description", c.role === "web-wallet" ? "One or two sentences for the directory and for wallet menus on Verifier pages." : "One or two sentences for the directory.", false, "textarea"),
  ];
  const app = [
    f("platforms", "Platforms", "", true, "platforms"),
    f("access", "How testers get it", "No public build is fine. Invite: TestFlight, a Play test track, or an APK you send on request. With us: there's nothing to share yet (say, iOS awaiting Apple's approval), so testers find you and try it on your phone.", true, "access"),
    f("installUrl", "Install link", accessOf(c) === "install"
      ? "An APK, a public TestFlight link, or a store page. No public build? Pick another option above."
      : accessOf(c) === "invite"
        ? "Optional: a TestFlight or test-track page testers can use once you've invited them. Say in Notes how to ask."
        : "Leave blank. Say in Notes where testers can find you during the event.", accessOf(c) === "install", "url"),
    f("requirements", "Phone needs", "What a tester's phone needs, such as \"Android 10 or later with Chrome 141 or later\" or \"iPhone with iOS 26 and Safari\".", false, "text"),
  ];
  const role: Field[] =
    c.role === "verifier"
      ? c.runsAs === "app" ? app : [f("url", "Check-in page URL", "Your public page that starts a check-in.", true, "url")]
      : c.role === "web-wallet"
        ? [
            f("walletUrl", "Wallet URL", "The page a Verifier opens. It must follow the client docs' Web wallets page.", true, "url"),
            f("iconUrl", "Icon URL", "Shown next to the name in wallet menus. SVG, PNG, WebP, or JPEG, up to 64 KB.", false, "url"),
            f("homepage", "Product home page", "Defaults to the organization's home page.", false, "url"),
            f("target", "Open as", "How the Verifier opens the wallet.", false, "target"),
            f("testPatient", "Test patient", "The synthetic patient it holds, so Verifier testers know what to expect.", false, "text"),
          ]
        : [
            ...app,
            f("largeResponses", "Large responses", "", false, "checkbox"),
            f("testPatient", "Test patient", "The synthetic patient it holds, so Verifier testers know what to expect.", false, "text"),
          ];
  const statusHint = appLike(c)
    ? "Up: it works now and testers can get it the way you chose above, including by trying it with you on your phone. Broken: it was up and isn't working now."
    : c.role === "web-wallet"
      ? "Up: anyone can open it now, without you. Only web wallets that are up go into wallets.json. Broken: it was up and isn't working now."
      : "Up: anyone can open it now, without you. Broken: it was up and isn't working now.";
  return [
    ...head,
    ...role,
    f("status", "Status", statusHint, true, "status"),
    f("notes", "Notes for testers", appLike(c) ? "Anything a tester needs to know: how to ask for an invite, a sign-in step, where to find you during the event." : "Anything a tester needs to know, such as a sign-in step.", false, "textarea"),
  ];
}
const accessOf = (c: FormComponent): Access => c.access ?? "install";

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const blank = (): FormState => ({ organization: "", homepage: "", contacts: [{ name: "" }], components: [] });

let state: FormState = blank();
let loadedFile: string | undefined; // set when editing an existing file
let existingIds = new Map<string, string>(); // component id -> file, from the published site
let validate: Validate;

/** Bring a stored file into the form: note whether each Verifier is an app. */
function fromFile(p: Participant): FormState {
  const s = structuredClone(p) as FormState;
  s.contacts ??= [];
  for (const c of s.components ?? []) if (c.role === "verifier") c.runsAs ??= c.platforms || (c.installUrl && !c.url) ? "app" : "page";
  return s;
}

// ---------------------------------------------------------------- output
function clean(p: FormState): Participant {
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !(v === "" || v === undefined || v === false || (Array.isArray(v) && !v.length))));
  const out: Record<string, unknown> = drop({ organization: p.organization.trim(), homepage: p.homepage?.trim() });
  out.contacts = (p.contacts ?? []).map((c) => drop({ name: c.name.trim(), github: c.github?.trim().replace(/^@/, ""), slack: c.slack?.trim(), email: c.email?.trim() })).filter((c) => Object.keys(c).length);
  out.components = p.components.map((c) => {
    const allowed = new Set(fieldsFor(c).map((x) => x.key));
    const kept: Record<string, unknown> = { id: c.id.trim(), role: c.role };
    for (const [k, v] of Object.entries(c)) if (allowed.has(k as keyof FormComponent) && k !== "id" && k !== "runsAs") kept[k] = typeof v === "string" ? v.trim() : v;
    return drop(kept);
  });
  return out as Participant;
}
const fileName = () => loadedFile ?? `${slug(state.organization) || "your-organization"}.json`;

function problems(p: Participant): string[] {
  const out = participantProblems(p, validate);
  for (const c of p.components) {
    const owner = existingIds.get(c.id);
    if (owner && owner !== loadedFile) out.push(`${c.name || c.id}: short id "${c.id}" is already used in participants/${owner}`);
  }
  return [...new Set(out)];
}

function refresh() {
  const p = clean(state);
  const json = JSON.stringify(p, null, 2) + "\n";
  renderJson($("json"), json);
  $("filename").textContent = `participants/${fileName()}`;
  const list = problems(p);
  const box = $("problems");
  box.className = `problems smart-callout ${list.length ? "bad" : "ok"}`;
  box.replaceChildren(...(list.length ? [el("b", {}, "Fix these first:"), el("ul", {}, ...list.map((x) => el("li", {}, x)))] : ["Looks good. This file passes the same checks the pull request will run."]));
  const advice = $("advice");
  const noGithub = !(p.contacts ?? []).some((c) => c.github);
  advice.hidden = !noGithub;
  advice.textContent = noGithub ? "No contact has a GitHub username, so this pull request can't merge automatically; a maintainer will review it. Add yours to have it merge on its own." : "";
  ($("submit") as HTMLButtonElement).disabled = list.length > 0;
  $("submit").textContent = loadedFile ? "Copy the JSON and open the file on GitHub" : "Open a pull request on GitHub";
  $("submit-note").textContent = loadedFile
    ? "GitHub can't prefill an edit to an existing file. The button copies your new JSON; on GitHub, select everything in the editor, paste, and propose the change."
    : "GitHub opens with the file filled in. Without write access to the repo, it offers to fork it and open a pull request for you.";
  try { sessionStorage.setItem("connectathon-registration", JSON.stringify({ state, loadedFile })); } catch { /* optional */ }
  return json;
}

// ---------------------------------------------------------------- form rendering
function input(value: string | undefined, onInput: (v: string) => void, props: Record<string, unknown> = {}) {
  const i = el("input", { value: value ?? "", ...props });
  i.addEventListener("input", () => { onInput(i.value); refresh(); });
  return i;
}
function select(id: string, options: [string, string][], current: string, onChange: (v: string) => void) {
  const s = el("select", { id });
  for (const [v, t] of options) s.append(el("option", { value: v, selected: current === v }, t));
  s.onchange = () => onChange(s.value);
  return s;
}

function renderContacts() {
  $("contacts").replaceChildren(...(state.contacts ?? []).map((c, idx) => {
    const card = el("div", { className: "card" });
    const remove = el("button", { type: "button", className: "remove" }, "Remove");
    remove.onclick = () => { state.contacts!.splice(idx, 1); renderContacts(); refresh(); };
    card.append(
      el("div", { className: "card-head" }, el("b", {}, `Contact ${idx + 1}`), remove),
      el("div", { className: "row2" },
        el("label", {}, "Name", input(c.name, (v) => (c.name = v))),
        el("label", {}, "GitHub username", input(c.github, (v) => (c.github = v), { placeholder: "without @", autocapitalize: "off", spellcheck: false })),
        el("label", {}, "Slack display name", input(c.slack, (v) => (c.slack = v))),
        el("label", {}, "Email", input(c.email, (v) => (c.email = v), { type: "email" })),
      ),
    );
    return card;
  }));
}

function renderComponents(focusId?: string) {
  $("components").replaceChildren(...state.components.map((c, idx) => {
    const card = el("div", { className: "card", id: `component-${idx}` });
    const remove = el("button", { type: "button", className: "remove" }, "Remove");
    remove.onclick = () => { state.components.splice(idx, 1); renderComponents(); refresh(); };
    card.append(el("div", { className: "card-head" }, el("b", {}, CARD_TITLE(c)), remove));
    if (c.role === "verifier") card.append(el("p", { className: "hint" }, VERIFIER_HINT));
    let idTouched = !!c.id;
    for (const { key, label, hint, required, kind } of fieldsFor(c)) {
      const fieldId = `c${idx}-${key}`;
      const req = required ? [" ", el("span", { className: "req" }, "required")] : [];
      let control: HTMLElement;
      let lab: HTMLElement = el("label", { htmlFor: fieldId }, label, ...req);
      if (kind === "status") {
        const up = appLike(c) ? "Up: testers can get it now" : "Up: anyone can open it now";
        control = select(fieldId, [["not-yet", "Not yet ready"], ["up", up], ["broken", "Broken for now"]], c.status, (v) => { c.status = v; refresh(); });
      } else if (kind === "target") {
        control = select(fieldId, [["tab", "A new tab (default)"], ["popup", "A popup window"]], c.target ?? "tab", (v) => { c.target = v as "tab" | "popup"; refresh(); });
      } else if (kind === "access") {
        control = select(fieldId, Object.entries(ACCESS_LABEL), accessOf(c), (v) => { c.access = v as Access; renderComponents(fieldId); refresh(); });
      } else if (kind === "runsAs" || kind === "platforms" || kind === "checkbox") {
        // Groups of choices: a fieldset, so the legend names them.
        control = el("fieldset", { className: "choices", id: fieldId });
        lab = el("legend", {}, label, ...req);
        control.append(lab);
        if (kind === "runsAs") {
          for (const [v, t] of [["page", "A web page: check-in page, portal, or kiosk"], ["app", "A phone app"]] as const) {
            const r = el("input", { type: "radio", name: fieldId, value: v, checked: (c.runsAs ?? "page") === v });
            r.onchange = () => {
              c.runsAs = v;
              if (v === "app") { c.platforms ??= ["android"]; c.access ??= "install"; }
              renderComponents(`${fieldId}-${v}`);
              refresh();
            };
            r.id = `${fieldId}-${v}`;
            control.append(el("label", {}, r, t));
          }
        } else if (kind === "platforms") {
          for (const p of ["android", "ios"]) {
            const box = el("input", { type: "checkbox", checked: (c.platforms ?? []).includes(p), value: p });
            box.onchange = () => { c.platforms = box.checked ? [...new Set([...(c.platforms ?? []), p])] : (c.platforms ?? []).filter((x) => x !== p); refresh(); };
            control.append(el("label", {}, box, p === "ios" ? "iOS" : "Android"));
          }
        } else {
          const box = el("input", { type: "checkbox", checked: !!c.largeResponses, id: `${fieldId}-box` });
          box.onchange = () => { c.largeResponses = box.checked; refresh(); };
          control.append(el("label", {}, box, "It can answer with responses over 512 KB (scenario L2). On Android, that means it uses the large-payload response API."));
        }
        card.append(control);
        if (hint) card.append(el("p", { className: "hint" }, hint));
        continue;
      } else if (kind === "textarea") {
        const t = el("textarea", { id: fieldId, rows: 2, value: (c[key] as string) ?? "" });
        t.addEventListener("input", () => { (c as any)[key] = t.value; refresh(); });
        control = t;
      } else {
        control = input(c[key] as string, (v) => {
          (c as any)[key] = v;
          if (key === "id") idTouched = true;
          if (key === "name" && !idTouched) {
            c.id = slug(`${state.organization ? slug(state.organization) + "-" : ""}${v}`);
            (document.getElementById(`c${idx}-id`) as HTMLInputElement).value = c.id;
          }
        }, { id: fieldId, type: kind === "url" ? "url" : "text", ...(kind === "url" ? { placeholder: "https://", autocapitalize: "off", spellcheck: false } : {}), ...(key === "id" ? { autocapitalize: "off", spellcheck: false } : {}) });
      }
      card.append(lab, control);
      if (hint) card.append(el("p", { className: "hint" }, hint));
    }
    return card;
  }));
  if (focusId) (document.getElementById(focusId) as HTMLElement | null)?.focus();
}

function renderAll() {
  ($("organization") as HTMLInputElement).value = state.organization;
  ($("homepage") as HTMLInputElement).value = state.homepage ?? "";
  renderContacts();
  renderComponents();
  refresh();
}

const renderJsonEl = (pre: HTMLElement, value: unknown) => { renderJson(pre, value); return pre; };

function renderExamples() {
  $("example-list").replaceChildren(...EXAMPLES.map((ex) => {
    const load = el("button", { type: "button", className: "smart-btn" }, "Load into the form");
    load.onclick = () => {
      loadedFile = undefined;
      ($("existing") as HTMLSelectElement).value = "";
      state = fromFile(ex.participant);
      renderAll();
      $("form").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    return el("details", { id: ex.id, className: "example smart-details" },
      el("summary", {}, el("b", {}, ex.title)),
      el("p", {}, ex.summary),
      el("p", { className: "hint" }, `participants/${ex.file}`),
      renderJsonEl(el("pre", { className: "smart-code" }), ex.participant),
      load,
    );
  }));
  const openFromHash = () => {
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target instanceof HTMLDetailsElement) { target.open = true; target.scrollIntoView(); }
  };
  addEventListener("hashchange", openFromHash);
  openFromHash();
}

// ---------------------------------------------------------------- actions
async function copyJson(): Promise<boolean> {
  const json = refresh();
  try {
    await navigator.clipboard.writeText(json);
    return true;
  } catch {
    const range = document.createRange();
    range.selectNodeContents($("json"));
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
    return false;
  }
}

async function submit() {
  const json = refresh();
  if (loadedFile) {
    const copied = await copyJson();
    $("submit-note").textContent = copied
      ? "Copied. In the GitHub editor that just opened, select everything, paste, and propose the change."
      : "Couldn't copy automatically; the JSON is selected, so copy it yourself, then paste it into the GitHub editor.";
    window.open(`https://github.com/${REPO}/edit/main/participants/${encodeURIComponent(loadedFile)}`, "_blank", "noopener");
    return;
  }
  const url = `https://github.com/${REPO}/new/main?filename=${encodeURIComponent(`participants/${fileName()}`)}&value=${encodeURIComponent(json)}`;
  window.open(url, "_blank", "noopener");
}

function download() {
  const blob = new Blob([refresh()], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: fileName() });
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------- start
async function start() {
  const [schema, index, components] = await Promise.all([
    fetch(new URL("participants/schema.json", SITE)).then((r) => r.json()),
    fetch(new URL("participants/index.json", SITE), { cache: "no-store" }).then((r) => r.json()).catch(() => []),
    fetch(new URL("components.json", SITE), { cache: "no-store" }).then((r) => r.json()).catch(() => []),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  validate = ajv.compile(schema);
  const orgFileByName = new Map((index as { file: string; organization: string }[]).map((x) => [x.organization, x.file]));
  existingIds = new Map((components as { id: string; organization: string }[]).map((c) => [c.id, orgFileByName.get(c.organization) ?? ""]));

  const existing = $("existing") as HTMLSelectElement;
  for (const { file, organization } of index as { file: string; organization: string }[]) existing.append(el("option", { value: file }, `${organization} (participants/${file})`));
  existing.onchange = async () => {
    if (!existing.value) {
      loadedFile = undefined;
      state = blank();
    } else {
      loadedFile = existing.value;
      state = fromFile(await (await fetch(new URL(`participants/${existing.value}`, SITE), { cache: "no-store" })).json());
    }
    renderAll();
  };

  ($("organization") as HTMLInputElement).addEventListener("input", (e) => { state.organization = (e.target as HTMLInputElement).value; refresh(); });
  ($("homepage") as HTMLInputElement).addEventListener("input", (e) => { state.homepage = (e.target as HTMLInputElement).value; refresh(); });
  $("add-contact").onclick = () => { (state.contacts ??= []).push({ name: "" }); renderContacts(); refresh(); };
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-add]")) {
    b.onclick = () => {
      const role = b.dataset.add as Role;
      state.components.push({
        id: "", role, name: "", status: "not-yet",
        ...(role === "verifier" ? { runsAs: "page" as const } : {}),
        ...(role === "web-wallet" ? { target: "tab" as const } : {}),
        ...(role === "native-wallet" ? { platforms: ["android"], access: "install" as const } : {}),
      });
      const idx = state.components.length - 1;
      renderComponents(`c${idx}-name`);
      refresh();
    };
  }
  $("submit").onclick = () => void submit();
  $("copy").onclick = async () => { $("submit-note").textContent = (await copyJson()) ? "Copied." : "Couldn't copy automatically; the JSON is selected."; };
  $("download").onclick = download;

  // Restore an unsent draft from this tab.
  try {
    const saved = JSON.parse(sessionStorage.getItem("connectathon-registration") ?? "null");
    if (saved?.state) { state = fromFile(saved.state); loadedFile = saved.loadedFile; if (loadedFile) existing.value = loadedFile; }
  } catch { /* optional */ }
  renderAll();
  renderExamples();
}

start().catch((e) => { $("problems").textContent = `Could not load the registration schema: ${(e as Error).message}`; });
