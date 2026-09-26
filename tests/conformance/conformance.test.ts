/**
 * The spec's conformance cases (github.com/smart-health-checkin/spec,
 * conformance/) run through the Testing EHR's own checks (testing-ehr/src/checks.ts):
 * a case is "valid" when none of the wire checks fail. Cases are fetched at a
 * pinned ref by scripts/fetch-conformance.sh. Listed known failures must keep
 * failing; remove a case from known-failures.json when it starts passing.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { base64UrlDecodeBytes } from "@smart-health-checkin/client/wire";
import { checkResponse, groupOf } from "../../testing-ehr/src/checks.ts";

const ROOT = join(import.meta.dir, "../../spec-conformance");
if (process.env.SPEC_CONFORMANCE_DIR || !existsSync(join(ROOT, ".ref"))) {
  const fetched = Bun.spawnSync([join(import.meta.dir, "../../scripts/fetch-conformance.sh")], { stdout: "inherit", stderr: "inherit" });
  if (!fetched.success) throw new Error("could not fetch conformance cases: run scripts/fetch-conformance.sh");
}

type Case = { id: string; capability: string; description: string; inputs: Record<string, string>; expected: { valid: boolean }; status: string };
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
  });
  // mdoc-verify covers the response element too, which the EHR files under "SMART response".
  const wireFailed = result.checks.some((ch) => ch.outcome === "fail" && (groupOf(ch.id) === "Wire" || ch.id === "element"));
  return !wireFailed === c.expected.valid;
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
