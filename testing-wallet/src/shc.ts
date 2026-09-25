// Minting SMART Health Cards with the test issuer (https://spec.smarthealth.cards/).
import { ISSUER, ISSUER_KID, ISSUER_PRIVATE_JWK } from "./issuer-key.ts";
import type { Entry } from "./match.ts";

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const utf8 = (s: string) => new TextEncoder().encode(s);

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Rewrite a set of entries into an SHC bundle: resource:N fullUrls and references, no ids or meta. */
function shcBundle(entries: Entry[]) {
  const index = new Map(entries.map((e, i) => [e.fullUrl, `resource:${i}`]));
  const rewrite = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value)) {
        if (k === "meta" || k === "id" || k === "text") continue;
        if (k === "reference" && typeof v === "string") out[k] = index.get(v) ?? v;
        else out[k] = rewrite(v);
      }
      return out;
    }
    return value;
  };
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: entries.map((e, i) => ({ fullUrl: `resource:${i}`, resource: rewrite(e.resource) })),
  };
}

export async function mintHealthCard(entries: Entry[], opts: { breakSignature?: boolean } = {}): Promise<string> {
  const header = { zip: "DEF", alg: "ES256", kid: ISSUER_KID };
  const payload = {
    iss: ISSUER,
    nbf: Math.floor(Date.now() / 1000),
    vc: {
      type: ["https://smarthealth.cards#health-card"],
      credentialSubject: { fhirVersion: "4.0.1", fhirBundle: shcBundle(entries) },
    },
  };
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(await deflateRaw(utf8(JSON.stringify(payload))))}`;
  const key = await crypto.subtle.importKey("jwk", ISSUER_PRIVATE_JWK, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, utf8(signingInput)));
  if (opts.breakSignature) sig[0] ^= 0xff;
  return `${signingInput}.${b64url(sig)}`;
}
