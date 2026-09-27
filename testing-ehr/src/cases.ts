// Test cases (catalog.json): a request, an optional step for the person using
// the wallet, and expectations a Verifier can check on the response. The
// Testing EHR evaluates the expectations next to its spec checks;
// scripts/build.ts validates the catalog and writes the scenario blocks of
// the front page (the minimum tier) and advanced.html (the advanced tier) with
// the same sentences.
import type { WalletConfig } from "../../testing-wallet/src/config.ts";

export type Expectation = (
  | { check: "status"; item: string; status: string[] }
  | { check: "every-status"; status: string[] }
  | { check: "includes-type"; item: string; resourceType: string }
  | { check: "media-type"; item: string; mediaType: string }
  | { check: "one-artifact"; items: string[] }
  | { check: "min-size"; kb: number }
) & (
  /** The spec requirement the expectation checks, such as "HOLD-4" (its anchor in the spec). */
  | { rule: string; basis?: never }
  /** Not a spec rule: the check confirms the case's step for the person using the wallet was done. */
  | { basis: "step"; rule?: never }
);

/** How the scenario blocks and the Testing EHR label a step check. */
export const STEP_DONE = "the step was done";

/** A spec requirement's address, from its id. */
export const ruleHref = (rule: string): string => `https://smart-health-checkin.org/spec/#${rule}`;

export type TestCase = {
  /** A short kebab-case name, used as the anchor, in the Testing EHR's #case=, and in results. */
  id: string;
  title: string;
  /** Which page lists the case: the minimum set on the front page, the rest on advanced.html. */
  tier: "minimum" | "advanced";
  /** The section of its page the case goes in, for pages with more than one (`<!-- test cases: TIER GROUP -->`). */
  group?: string;
  /** What the case tests, in one sentence. */
  summary: string;
  /** A file in requests/. */
  request: string;
  paths: ("web" | "native")[];
  /** What the person using the wallet does, and the SMART Testing Wallet config that does it. */
  walletStep?: { text: string; testingWallet?: WalletConfig };
  expect: Expectation[];
  /** What to look for in the wallet, by eye. */
  walletShows?: string[];
  /** What the Verifier under test should show, by eye. */
  verifierShows?: string[];
  /** Anything else to record or know, in Markdown. */
  notes?: string;
  specSections: string[];
};

/** The catalog's plain description of each request file, by file name. */
export type RequestInfo = { asks: string };

/** The page and anchor that describe a case, relative to the connectathon root. */
export const caseHref = (tc: Pick<TestCase, "id" | "tier">): string =>
  `${tc.tier === "minimum" ? "./" : "advanced.html"}#${tc.id}`;

/** A case's name and title, as the result form and the Testing EHR show it: "share-records: Share records". */
export const caseLabel = (tc: Pick<TestCase, "id" | "title">): string => `${tc.id}: ${tc.title}`;

type Item = { id: string; title: string; content: { kind: string; profiles?: readonly string[]; profilesFrom?: readonly string[] } };
type Request = { items: readonly Item[] };

const or = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs.at(-1)}` : xs[0] ?? "");
const and = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");

/** The expectation as a sentence, naming items by their titles in the request. */
export function describeExpectation(e: Expectation, request: Request): string {
  const t = (id: string) => `“${request.items.find((i) => i.id === id)?.title ?? id}”`;
  switch (e.check) {
    case "status": return `${t(e.item)} is ${or(e.status)}.`;
    case "every-status": return `Every item is ${or(e.status)}.`;
    case "includes-type": return `${t(e.item)} includes a ${e.resourceType} record.`;
    case "media-type": return `${t(e.item)} comes as ${e.mediaType}.`;
    case "one-artifact": return `One record answers ${and(e.items.map(t))}.`;
    case "min-size": return `The response is at least ${e.kb >= 1024 ? `${e.kb / 1024} MB` : `${e.kb} KB`}.`;
  }
}

/** Problems with a test case against its request, in words. */
export function caseProblems(tc: TestCase, request: Request, requirementIds?: ReadonlySet<string>): string[] {
  const ids = new Set(request.items.map((i) => i.id));
  const problems: string[] = [];
  const known = (id: string) => { if (!ids.has(id)) problems.push(`${tc.id}: item "${id}" isn't in ${tc.request}`); };
  for (const e of tc.expect) {
    if ("item" in e) known(e.item);
    if (e.check === "one-artifact") e.items.forEach(known);
    // Every check traces to the spec (a requirement id) or to the case's own step.
    const n = `${tc.id} expectation ${tc.expect.indexOf(e) + 1} (${e.check})`;
    if (e.rule !== undefined && e.basis !== undefined) problems.push(`${n}: has both a rule and a basis; give one`);
    else if (e.rule !== undefined) {
      if (requirementIds ? !requirementIds.has(e.rule) : !/^[A-Z0-9]+-\d+$/.test(e.rule)) problems.push(`${n}: rule "${e.rule}" isn't a requirement id in the spec's requirements.json`);
    } else if (e.basis === "step") {
      if (!tc.walletStep?.text) problems.push(`${n}: a step check needs the case's walletStep to state the step`);
    } else problems.push(`${n}: needs a "rule" (a spec requirement id) or "basis": "step"; a check that traces to neither doesn't belong in the case`);
    if (!["status", "every-status", "includes-type", "media-type", "one-artifact", "min-size"].includes(e.check)) problems.push(`${tc.id}: unknown check "${(e as { check: string }).check}"`);
  }
  for (const id of Object.keys(tc.walletStep?.testingWallet?.status ?? {})) known(id);
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(tc.id)) problems.push(`${tc.id}: the id must be kebab-case`);
  if (tc.tier !== "minimum" && tc.tier !== "advanced") problems.push(`${tc.id}: tier must be "minimum" or "advanced"`);
  if (tc.walletStep?.testingWallet && !tc.walletStep.text) problems.push(`${tc.id}: a Testing Wallet config needs the step's text`);
  return problems;
}

export type Evaluated = { id: string; title: string; outcome: "pass" | "fail"; detail: string; rule?: string; basis?: "step" };
export type Observed = {
  request: Request;
  smartResponse?: { artifacts?: any[] };
  /** Per item, its valid status or "unknown". Missing when the response was rejected. */
  items?: Record<string, string>;
  /** Per artifact id, whether the Verifier uses it. */
  artifacts?: Record<string, "accepted" | "rejected">;
  responseChars?: number;
  /** The resources in a usable artifact (SMART Health Cards decoded). */
  resourcesOf: (artifact: any) => any[];
};

/** Evaluate a case's expectations against what came back. */
export function evaluateExpectations(expect: Expectation[], o: Observed): Evaluated[] {
  const usable = (o.smartResponse?.artifacts ?? []).filter((a) => o.artifacts?.[a?.id] === "accepted");
  const forItem = (id: string) => usable.filter((a) => (a.fulfills ?? []).includes(id));
  const records = (id: string) => forItem(id).flatMap(o.resourcesOf);
  return expect.map((e, n) => {
    const title = describeExpectation(e, o.request);
    const result = (ok: boolean, detail: string): Evaluated => ({ id: `expect-${n + 1}`, title, outcome: ok ? "pass" : "fail", detail, ...(e.rule ? { rule: e.rule } : {}), ...(e.basis ? { basis: e.basis } : {}) });
    if (!o.items) return result(false, "the response was rejected");
    switch (e.check) {
      case "status": {
        const got = o.items[e.item] ?? "no status";
        return result(e.status.includes(got), `got ${got}`);
      }
      case "every-status": {
        const off = o.request.items.filter((i) => !e.status.includes(o.items![i.id] ?? "no status"));
        return result(!off.length, off.length ? off.map((i) => `${i.id} is ${o.items![i.id] ?? "no status"}`).join("; ") : "");
      }
      case "includes-type": {
        const n = records(e.item).filter((r) => r?.resourceType === e.resourceType).length;
        return result(n > 0, `${n} ${e.resourceType} record${n === 1 ? "" : "s"}`);
      }
      case "media-type": {
        const types = [...new Set(forItem(e.item).map((a) => a.mediaType))];
        return result(types.includes(e.mediaType), types.length ? `got ${types.join(", ")}` : "no usable record");
      }
      case "one-artifact": {
        const shared = usable.find((a) => e.items.every((id) => (a.fulfills ?? []).includes(id)));
        return result(!!shared, shared ? `record ${shared.id}` : "no single record lists them all in fulfills");
      }
      case "min-size": {
        const kb = (o.responseChars ?? 0) / 1024;
        return result(kb >= e.kb, `${kb.toFixed(1)} KB`);
      }
    }
  });
}
