import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { participantProblems, type Component } from "../register/src/participant.ts";
import { EXAMPLES } from "../register/src/examples.ts";

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(readFileSync("participants/schema.json", "utf8")));
const check = (data: unknown) => participantProblems(data, validate);
const file = (...components: Partial<Component>[]) => ({
  organization: "Example",
  contacts: [{ name: "Pat", github: "pat" }],
  components: components.map((c, i) => ({ id: `c${i}`, name: `Component ${i}`, status: "up", ...c })),
});

test("every participant file in the repo passes", () => {
  for (const f of readdirSync("participants").filter((f) => f.endsWith(".json") && f !== "schema.json")) {
    expect([f, check(JSON.parse(readFileSync(`participants/${f}`, "utf8")))]).toEqual([f, []]);
  }
});

test("the examples on the registration form pass", () => {
  for (const ex of EXAMPLES) expect([ex.id, check(ex.participant)]).toEqual([ex.id, []]);
});

test("a native wallet needs no install link when testers get it another way", () => {
  expect(check(file({ role: "native-wallet", platforms: ["ios"], access: "invite" }))).toEqual([]);
  expect(check(file({ role: "native-wallet", platforms: ["ios"], access: "team-device" }))).toEqual([]);
  expect(check(file({ role: "native-wallet", platforms: ["android"], access: "invite", installUrl: "https://example.org/testflight" }))).toEqual([]);
});

test("a native wallet anyone can install needs its install link", () => {
  expect(check(file({ role: "native-wallet", platforms: ["android"], installUrl: "https://example.org/app.apk" }))).toEqual([]);
  const missing = ["Component 0: add an Install link (installUrl), or set How testers get it (access) to an invite or testing with you"];
  expect(check(file({ role: "native-wallet", platforms: ["android"] }))).toEqual(missing);
  expect(check(file({ role: "native-wallet", platforms: ["android"], access: "install" }))).toEqual(missing);
});

test("a native wallet needs platforms", () => {
  expect(check(file({ role: "native-wallet", access: "invite" }))).toEqual(["Component 0: Platforms is required"]);
  expect(check(file({ role: "native-wallet", access: "invite", platforms: [] }))).toEqual(["Component 0: pick at least one platform"]);
});

test("the stored role for a Verifier is still ehr, as a web page or a phone app", () => {
  expect(check(file({ role: "ehr", url: "https://example.org/checkin" }))).toEqual([]);
  expect(check(file({ role: "ehr", platforms: ["android"], installUrl: "https://example.org/app.apk" }))).toEqual([]);
  expect(check(file({ role: "ehr", platforms: ["ios"], access: "team-device" }))).toEqual([]);
  expect(check(file({ role: "ehr", platforms: ["android"] }))).toHaveLength(1);
  expect(check(file({ role: "ehr" }))).toEqual(["Component 0: a Verifier needs a check-in page URL, or platforms if it is a phone app"]);
  expect(check(file({ role: "verifier" as any, url: "https://example.org/checkin" }))[0]).toStartWith("Component 0: Role must be one of");
});

test("a web wallet needs its wallet URL", () => {
  expect(check(file({ role: "web-wallet", walletUrl: "https://example.org/wallet" }))).toEqual([]);
  expect(check(file({ role: "web-wallet" }))).toEqual(["Component 0: Wallet URL is required"]);
});

test("contacts: at least one, each reachable, GitHub usernames without @", () => {
  expect(check({ ...file({ role: "ehr", url: "https://example.org/" }), contacts: undefined })).toEqual(["Contacts: add at least one contact"]);
  expect(check({ ...file({ role: "ehr", url: "https://example.org/" }), contacts: [] })).toEqual(["Contacts: add at least one contact"]);
  expect(check({ ...file({ role: "ehr", url: "https://example.org/" }), contacts: [{ name: "Pat" }] })).toEqual([
    "Contact 1: add a GitHub username, Slack display name, or email, so testers can reach them",
  ]);
  expect(check({ ...file({ role: "ehr", url: "https://example.org/" }), contacts: [{ name: "Pat", slack: "Pat D" }] })).toEqual([]);
  expect(check({ ...file({ role: "ehr", url: "https://example.org/" }), contacts: [{ name: "Pat", github: "@pat" }] })).toEqual([
    "Contact 1: GitHub username only, without @ or a URL",
  ]);
});

test("readable messages for URLs, ids, and duplicates", () => {
  expect(check(file({ role: "ehr", url: "http://example.org/" }))).toEqual(["Component 0: Check-in page URL must start with https://"]);
  expect(check(file({ role: "ehr", url: "example.org" }))).toContain("Component 0: Check-in page URL must be a full URL starting with https://");
  expect(check(file({ role: "ehr", url: "https://example.org/", id: "Bad Id" }))).toEqual([
    "Component 0: Short id may use only lowercase letters, digits, and hyphens, starting with a letter or digit",
  ]);
  expect(check(file({ role: "ehr", url: "https://example.org/", id: "x" }, { role: "ehr", url: "https://example.org/", id: "x" }))).toEqual([
    'Component 1: short id "x" is used twice in this file',
  ]);
  expect(check(file({ role: "ehr", url: "https://example.org/", installUrI: "typo" } as any))).toEqual(['Component 0: unknown field "installUrI"']);
});
