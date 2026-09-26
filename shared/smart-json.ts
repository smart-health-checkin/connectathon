// JSON with the site's syntax colors, from /assets/smart-json.js on the apex. The build adds a
// <script type="module"> for it ahead of each tool's bundle, and the module sets
// globalThis.SmartJson (see "JSON at runtime" in the apex MAINTAINING.md). The text content is
// exactly the JSON text, so copying or reading a pre back still gives valid JSON.
type Replacer = (this: unknown, key: string, value: unknown) => unknown;
type SmartJsonApi = {
  jsonToHtml(value: unknown, options?: { indent?: number; replacer?: Replacer }): string;
  renderJson(el: Element, value: unknown, options?: { indent?: number; replacer?: Replacer }): Element;
};
const api = () => (globalThis as { SmartJson?: SmartJsonApi }).SmartJson;
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const text = (value: unknown, replacer?: Replacer) => (typeof value === "string" ? value : JSON.stringify(value, replacer, 2) ?? "");

/** Fills el with value as highlighted JSON (a string is shown as it is). */
export function renderJson(el: Element, value: unknown, replacer?: Replacer): void {
  const sj = api();
  if (sj) sj.renderJson(el, value, replacer ? { replacer } : undefined);
  else el.textContent = text(value, replacer);
}

/** The same, as an HTML string for a template. */
export function jsonHtml(value: unknown): string {
  const sj = api();
  return sj ? sj.jsonToHtml(value) : esc(text(value));
}
