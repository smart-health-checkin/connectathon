// Registration form: builds participants/<org>.json and opens GitHub with it.
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const SITE = new URL("../", location.href).href;
const REPO = "smart-health-checkin/connectathon";

type Role = "ehr" | "web-wallet" | "native-wallet";
type Contact = { name: string; github?: string; slack?: string; email?: string };
type Component = {
  id: string; role: Role; name: string; status: string; description?: string;
  url?: string; walletUrl?: string; iconUrl?: string; homepage?: string; target?: string;
  installUrl?: string; platforms?: string[]; testPatient?: string; notes?: string;
};
type Participant = { organization: string; homepage?: string; contacts?: Contact[]; components: Component[] };

const ROLE_NAMES: Record<Role, string> = { ehr: "EHR check-in page", "web-wallet": "Web wallet", "native-wallet": "Native wallet" };
// Fields per role, in display order: [key, label, hint, required, kind]
type Field = [keyof Component, string, string, boolean, "text" | "url" | "textarea" | "status" | "target" | "platforms"];
const COMMON_HEAD: Field[] = [
  ["name", "Name", "As testers should see it.", true, "text"],
  ["id", "Id", "Lowercase letters, digits, and hyphens. Unique across all participants. A web wallet's id is also its registry id.", true, "text"],
  ["status", "Status", "Set to up when others can test against it.", true, "status"],
  ["description", "Description", "One or two sentences for the directory and, for web wallets, EHR wallet menus.", false, "textarea"],
];
const ROLE_FIELDS: Record<Role, Field[]> = {
  ehr: [["url", "Check-in page URL", "Your public page that starts a check-in.", true, "url"]],
  "web-wallet": [
    ["walletUrl", "Wallet URL", "The page an EHR opens. It must follow the web wallet hand-off.", true, "url"],
    ["iconUrl", "Icon URL", "Shown next to the name in EHR wallet menus.", false, "url"],
    ["homepage", "Product home page", "Defaults to the organization's home page.", false, "url"],
    ["target", "Open as", "How the EHR opens the wallet.", false, "target"],
    ["testPatient", "Test patient", "The synthetic patient it holds, so EHR testers know what to expect.", false, "text"],
  ],
  "native-wallet": [
    ["installUrl", "Install link", "An APK link, a TestFlight invite, or a store page.", true, "url"],
    ["platforms", "Platforms", "", true, "platforms"],
    ["testPatient", "Test patient", "The synthetic patient it holds.", false, "text"],
  ],
};
const COMMON_TAIL: Field[] = [["notes", "Notes for testers", "Anything a tester needs to know, such as a sign-in step.", false, "textarea"]];

const $ = (id: string) => document.getElementById(id)!;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  Object.assign(n, props);
  n.append(...children);
  return n;
}
const slug = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

let state: Participant = { organization: "", homepage: "", contacts: [{ name: "" }], components: [] };
let loadedFile: string | undefined; // set when editing an existing file
let existingIds = new Map<string, string>(); // component id -> file, from the published site
let validate: ((v: unknown) => boolean) & { errors?: any[] | null };

// ---------------------------------------------------------------- output
function clean(p: Participant): Participant {
  const drop = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => !(v === "" || v === undefined || (Array.isArray(v) && !v.length))));
  const out: Record<string, unknown> = drop({ organization: p.organization.trim(), homepage: p.homepage?.trim() });
  const contacts = (p.contacts ?? []).map((c) => drop({ name: c.name.trim(), github: c.github?.trim().replace(/^@/, ""), slack: c.slack?.trim(), email: c.email?.trim() })).filter((c) => Object.keys(c).length);
  if (contacts.length) out.contacts = contacts;
  out.components = p.components.map((c) => {
    const allowed = new Set([...COMMON_HEAD, ...ROLE_FIELDS[c.role], ...COMMON_TAIL].map((f) => f[0]));
    const kept: Record<string, unknown> = { id: c.id.trim(), role: c.role };
    for (const [k, v] of Object.entries(c)) if (allowed.has(k as keyof Component) && k !== "id") kept[k] = typeof v === "string" ? v.trim() : v;
    return drop(kept);
  });
  return out as Participant;
}
const fileName = () => loadedFile ?? `${slug(state.organization) || "your-organization"}.json`;

function problems(p: Participant): string[] {
  const out: string[] = [];
  if (!validate(p)) {
    for (const e of validate.errors ?? []) {
      const where = e.instancePath.replace(/^\/components\/(\d+)/, (_: string, i: string) => `${p.components[+i]?.name || `component ${+i + 1}`}`).replace(/^\//, "").replace(/\//g, " › ");
      out.push(`${where || "file"}: ${e.message}`);
    }
  }
  const seen = new Set<string>();
  for (const c of p.components) {
    if (seen.has(c.id)) out.push(`id "${c.id}" is used twice in this file`);
    seen.add(c.id);
    const owner = existingIds.get(c.id);
    if (owner && owner !== loadedFile) out.push(`id "${c.id}" is already used in participants/${owner}`);
    for (const k of ["url", "walletUrl", "installUrl", "iconUrl", "homepage"] as const) {
      const v = c[k];
      if (v && !v.startsWith("https://")) out.push(`${c.name || c.id}: ${k} must start with https://`);
    }
  }
  if (!p.components.length) out.push("add at least one component");
  return [...new Set(out)];
}

function refresh() {
  const p = clean(state);
  const json = JSON.stringify(p, null, 2) + "\n";
  $("json").textContent = json;
  $("filename").textContent = `participants/${fileName()}`;
  const list = problems(p);
  const box = $("problems");
  box.className = `problems${list.length ? "" : " ok"}`;
  box.replaceChildren(...(list.length ? [el("b", {}, "Fix these first:"), el("ul", {}, ...list.map((x) => el("li", {}, x)))] : ["Looks good. This file passes the same checks the pull request will run."]));
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

function renderContacts() {
  $("contacts").replaceChildren(...(state.contacts ?? []).map((c, idx) => {
    const card = el("div", { className: "card" });
    const remove = el("button", { type: "button", className: "remove" }, "Remove");
    remove.onclick = () => { state.contacts!.splice(idx, 1); renderContacts(); refresh(); };
    card.append(
      el("div", { className: "card-head" }, el("b", {}, `Contact ${idx + 1}`), remove),
      el("div", { className: "row2" },
        el("label", {}, "Name", input(c.name, (v) => (c.name = v))),
        el("label", {}, "GitHub username", input(c.github, (v) => (c.github = v), { placeholder: "without @" })),
        el("label", {}, "Slack display name", input(c.slack, (v) => (c.slack = v))),
        el("label", {}, "Email", input(c.email, (v) => (c.email = v), { type: "email" })),
      ),
    );
    return card;
  }));
}

function renderComponents() {
  $("components").replaceChildren(...state.components.map((c, idx) => {
    const card = el("div", { className: "card" });
    const remove = el("button", { type: "button", className: "remove" }, "Remove");
    remove.onclick = () => { state.components.splice(idx, 1); renderComponents(); refresh(); };
    card.append(el("div", { className: "card-head" }, el("b", {}, ROLE_NAMES[c.role]), remove));
    let idTouched = !!c.id;
    for (const [key, label, hint, required, kind] of [...COMMON_HEAD, ...ROLE_FIELDS[c.role], ...COMMON_TAIL]) {
      const fieldId = `c${idx}-${key}`;
      const lab = el("label", { htmlFor: fieldId }, label, ...(required ? [" ", el("span", { className: "req" }, "required")] : []));
      let control: HTMLElement;
      if (kind === "status") {
        const s = el("select", { id: fieldId });
        for (const [v, t] of [["not-yet", "Not yet"], ["up", "Up: ready for testing"], ["broken", "Broken"]]) s.append(el("option", { value: v, selected: c.status === v }, t));
        s.onchange = () => { c.status = s.value; refresh(); };
        control = s;
      } else if (kind === "target") {
        const s = el("select", { id: fieldId });
        for (const [v, t] of [["tab", "A new tab (default)"], ["popup", "A popup window"]]) s.append(el("option", { value: v, selected: (c.target ?? "tab") === v }, t));
        s.onchange = () => { c.target = s.value; refresh(); };
        control = s;
      } else if (kind === "platforms") {
        control = el("div", { className: "inline", id: fieldId });
        for (const p of ["android", "ios"]) {
          const box = el("input", { type: "checkbox", checked: (c.platforms ?? []).includes(p) });
          box.onchange = () => { c.platforms = box.checked ? [...new Set([...(c.platforms ?? []), p])] : (c.platforms ?? []).filter((x) => x !== p); refresh(); };
          control.append(el("label", {}, box, p === "ios" ? "iOS" : "Android"));
        }
      } else if (kind === "textarea") {
        const t = el("textarea", { id: fieldId, rows: 2, value: (c[key] as string) ?? "" });
        t.addEventListener("input", () => { (c as any)[key] = t.value; refresh(); });
        control = t;
      } else {
        const i = input(c[key] as string, (v) => {
          (c as any)[key] = v;
          if (key === "id") idTouched = true;
          if (key === "name" && !idTouched) {
            c.id = slug(`${state.organization ? slug(state.organization) + "-" : ""}${v}`);
            (document.getElementById(`c${idx}-id`) as HTMLInputElement).value = c.id;
          }
        }, { id: fieldId, type: kind === "url" ? "url" : "text", ...(kind === "url" ? { placeholder: "https://" } : {}) });
        control = i;
      }
      card.append(lab, control);
      if (hint) card.append(el("p", { className: "hint" }, hint));
    }
    return card;
  }));
}

function renderAll() {
  ($("organization") as HTMLInputElement).value = state.organization;
  ($("homepage") as HTMLInputElement).value = state.homepage ?? "";
  renderContacts();
  renderComponents();
  refresh();
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

  const select = $("existing") as HTMLSelectElement;
  for (const { file, organization } of index as { file: string; organization: string }[]) select.append(el("option", { value: file }, `${organization} (participants/${file})`));
  select.onchange = async () => {
    if (!select.value) {
      loadedFile = undefined;
      state = { organization: "", homepage: "", contacts: [{ name: "" }], components: [] };
    } else {
      loadedFile = select.value;
      state = await (await fetch(new URL(`participants/${select.value}`, SITE), { cache: "no-store" })).json();
      state.contacts ??= [];
    }
    renderAll();
  };

  ($("organization") as HTMLInputElement).addEventListener("input", (e) => { state.organization = (e.target as HTMLInputElement).value; refresh(); });
  ($("homepage") as HTMLInputElement).addEventListener("input", (e) => { state.homepage = (e.target as HTMLInputElement).value; refresh(); });
  $("add-contact").onclick = () => { (state.contacts ??= []).push({ name: "" }); renderContacts(); refresh(); };
  for (const b of document.querySelectorAll<HTMLButtonElement>("[data-add]")) {
    b.onclick = () => {
      const role = b.dataset.add as Role;
      state.components.push({ id: "", role, name: "", status: "not-yet", ...(role === "web-wallet" ? { target: "tab" } : {}), ...(role === "native-wallet" ? { platforms: ["android"] } : {}) });
      renderComponents();
      refresh();
    };
  }
  $("submit").onclick = () => void submit();
  $("copy").onclick = async () => { $("submit-note").textContent = (await copyJson()) ? "Copied." : "Couldn't copy automatically; the JSON is selected."; };
  $("download").onclick = download;

  // Restore an unsent draft from this tab.
  try {
    const saved = JSON.parse(sessionStorage.getItem("connectathon-registration") ?? "null");
    if (saved?.state) { state = saved.state; loadedFile = saved.loadedFile; if (loadedFile) select.value = loadedFile; }
  } catch { /* optional */ }
  renderAll();
}

start().catch((e) => { $("problems").textContent = `Could not load the registration schema: ${(e as Error).message}`; });
