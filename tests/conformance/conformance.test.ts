/**
 * The spec's conformance cases (github.com/smart-health-checkin/spec,
 * conformance/) run through the Testing EHR's own checks (testing-ehr/src/checks.ts).
 * hpke-open and mdoc-verify cases go through checkResponse: a case is accepted
 * when no wire check rejects it. cross-validation cases go through
 * checkSmartResponse, comparing per-item and per-Artifact outcomes too. Cases are fetched at a
 * pinned ref by scripts/fetch-conformance.sh. Listed known failures must keep
 * failing; remove a case from known-failures.json when it starts passing.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { base64UrlDecodeBytes } from "@smart-health-checkin/client/wire";
import { checkResponse, checkSmartResponse, groupOf } from "../../testing-ehr/src/checks.ts";

const ROOT = join(import.meta.dir, "../../spec-conformance");
if (process.env.SPEC_CONFORMANCE_DIR || !existsSync(join(ROOT, ".ref"))) {
  const fetched = Bun.spawnSync([join(import.meta.dir, "../../scripts/fetch-conformance.sh")], { stdout: "inherit", stderr: "inherit" });
  if (!fetched.success) throw new Error("could not fetch conformance cases: run scripts/fetch-conformance.sh");
}

type Case = { id: string; capability: string; description: string; inputs: Record<string, string>; expected: { outcome: string; warnings?: string[]; items?: Record<string, string>; artifacts?: Record<string, string> }; status: string };
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as { cases: Case[] };
const config = JSON.parse(readFileSync(join(import.meta.dir, "known-failures.json"), "utf8")) as { claims: string[]; knownFailures: Record<string, string> };
const text = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DUMMY_REQUEST = {
  type: "smart-health-checkin-request", version: "1", id: "conformance-request", items: [
    { id: "patient", title: "Patient", content: { kind: "selection.fhir" }, accept: ["application/fhir+json"] },
  ],
};

async function run(c: Case): Promise<boolean> {
  const i = c.inputs;
  if (c.capability === "cross-validation") {
    const result = await checkSmartResponse(JSON.parse(text(i.request!)), text(i.response!), { verifyHealthCards: false });
    const accepted = !result.rejected;
    if (c.expected.outcome === "reject") return !accepted;
    if (!accepted) return false;
    // Per-item: "unknown" means the status rows for that item were wrong (XV-3).
    for (const [item, want] of Object.entries(c.expected.items ?? {})) if ((result.items?.[item] === "unknown" ? "unknown" : "ok") !== want) return false;
    for (const [artifact, want] of Object.entries(c.expected.artifacts ?? {})) if (result.artifacts?.[artifact] !== want) return false;
    return true;
  }
  const jwk = JSON.parse(text(i.recipientPrivateJwk!)) as JsonWebKey;
  const privateKey = await crypto.subtle.importKey("jwk", { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const publicJwk = { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
  const result = await checkResponse({
    request: DUMMY_REQUEST as never,
    credential: JSON.parse(text(i.credential!)),
    verifierKeyPair: { privateKey, publicKey },
    verifierPublicJwk: publicJwk,
    encryptionInfoBytes: base64UrlDecodeBytes(text(i.encryptionInfo!).trim()),
    origin: text(i.origin!).trim(),
    now: i.now ? new Date(text(i.now).trim()) : undefined,
    verifyHealthCards: false,
  });
  // These capabilities cover the wire and the response element; the dummy
  // request makes the SMART response itself irrelevant here.
  const accepted = !result.checks.some((ch) => ch.outcome === "fail" && ch.scope === "response" && (groupOf(ch.id) === "Wire" || ch.id === "element"));
  // Warning reporting is advisory (RCV-1): note it, don't gate on it.
  if (accepted && c.expected.outcome === "warn") {
    const reported = new Set(result.checks.filter((ch) => ch.outcome === "warn").map((ch) => ch.code));
    const missing = (c.expected.warnings ?? []).filter((w) => !reported.has(w));
    if (missing.length) console.log(`advisory: ${c.id} accepted without reporting ${missing.join(", ")}`);
  }
  switch (c.expected.outcome) {
    case "reject": return !accepted;
    case "warn-or-reject": return true;
    default: return accepted;
  }
}

const claimed = new Set(config.claims);
describe("spec conformance (Testing EHR checks)", () => {
  for (const c of manifest.cases) {
    const known = config.knownFailures[c.id];
    test.skipIf(c.status === "pending" || !claimed.has(c.capability))(`${c.id}${known ? " (known failure)" : ""}`, async () => {
      const passed = await run(c);
      if (known) expect(passed, `${c.id} passes now: remove it from known-failures.json`).toBe(false);
      else expect(passed, `${c.id}: ${c.description}`).toBe(true);
    });
  }
});
