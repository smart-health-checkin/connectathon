// Writes the Testing Wallet's option tables in testing-wallet/FEATURES.md from
// testing-wallet/src/config.ts, so the docs and the code can't disagree.
//
//   bun scripts/wallet-docs.ts          rewrite the generated blocks
//   bun scripts/wallet-docs.ts --check  fail if they are out of date (run by `bun run check`)
//
// Each block sits between <!-- generated: NAME --> and <!-- /generated -->.
import { FAULTS, PATIENTS, RESPONSE_SIZES, STATUSES } from "../testing-wallet/src/config.ts";

const FILE = new URL("../testing-wallet/FEATURES.md", import.meta.url);
const spec = (id: string) => `[${id}](https://smart-health-checkin.org/spec/#${id})`;
const code = (s: string) => `\`${s}\``;
const quoted = (xs: string[]) => {
  const q = xs.map((x) => code(JSON.stringify(x)));
  return q.length > 2 ? `${q.slice(0, -1).join(", ")}, or ${q.at(-1)}` : q.join(" or ");
};

const blocks: Record<string, string> = {
  faults: [
    "| Fault | What it does | The Verifier |",
    "| --- | --- | --- |",
    ...Object.entries(FAULTS).map(([k, f]) => `| ${code(k)} | ${f.does} | ${f.verifier}${f.req ? ` (${spec(f.req)})` : ""} |`),
  ].map((l) => `  ${l}`).join("\n"), // indented: the table sits inside a list item
  "config-fields": [
    "| Field | Value | What it does |",
    "| --- | --- | --- |",
    `| ${code("faults")} | array of fault names: ${Object.keys(FAULTS).map(code).join(", ")} | Turns those faults on ([Faults](#testing-panel)) |`,
    `| ${code("status")} | object of request item id to ${quoted([...STATUSES])} | Forces that item's status; ids not in the request are ignored |`,
    `| ${code("size")} | ${quoted(Object.keys(RESPONSE_SIZES))} (${Object.values(RESPONSE_SIZES).map((s) => s.label).join(", ")}) | The response size setting |`,
    `| ${code("patient")} | ${quoted(Object.keys(PATIENTS))} (${Object.values(PATIENTS).join("; ")}); the first is the default | Which synthetic patient answers |`,
  ].join("\n"),
};

const text = await Bun.file(FILE).text();
let out = text;
for (const [name, body] of Object.entries(blocks)) {
  const re = new RegExp(`(<!-- generated: ${name} -->\\n)[\\s\\S]*?(\\n *<!-- /generated -->)`);
  if (!re.test(out)) throw new Error(`FEATURES.md has no <!-- generated: ${name} --> block`);
  out = out.replace(re, `$1${body}$2`);
}

if (process.argv.includes("--check")) {
  if (out !== text) {
    console.error("testing-wallet/FEATURES.md is out of date with config.ts: run `bun scripts/wallet-docs.ts`");
    process.exit(1);
  }
  console.log("testing-wallet/FEATURES.md matches config.ts");
} else {
  await Bun.write(FILE, out);
  console.log("wrote the generated tables in testing-wallet/FEATURES.md");
}
