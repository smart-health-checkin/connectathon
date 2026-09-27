// The SMART Testing Wallet's config URLs: its own public URL language, specified
// in ../FEATURES.md ("Config URLs"). Not part of SMART Health Check-in.
//
//   <wallet>/                     normal
//   <wallet>/<base64url JSON>/    starts with those test options
//
// The one place the format is encoded. The Testing Wallet reads it, the
// Testing EHR's "Testing Wallet options" builder writes it, and
// scripts/self-test.ts builds its URLs with it, so the three can't drift.

/**
 * Faults: what each one does to the response, and how a Verifier that follows
 * the spec reacts (with the requirement that says so). FEATURES.md's fault
 * table is generated from this (scripts/wallet-docs.ts).
 */
export const FAULTS: Record<string, { does: string; verifier: string; req?: string }> = {
  "wrong-canonical": { does: "QuestionnaireResponse.questionnaire doesn't match the request", verifier: "sets that record aside", req: "XV-10" },
  "missing-status": { does: "Leave one item without a status", verifier: "treats that item as unknown", req: "XV-3" },
  "duplicate-status": { does: "Give one item two statuses", verifier: "treats that item as unknown", req: "XV-3" },
  "wrong-request-id": { does: "requestId doesn't match", verifier: "rejects the response", req: "XV-2" },
  "unaccepted-media-type": { does: "Return an artifact in a media type the item didn't accept", verifier: "sets that record aside", req: "XV-7" },
  "bad-signature": { does: "Corrupt the issuer signature", verifier: "warns and continues", req: "VRS-5" },
  "bad-encryption": { does: "Corrupt the HPKE ciphertext", verifier: "rejects the response", req: "VRS-3" },
  "wrong-origin": { does: "Bind the transcript to the origin with a trailing slash", verifier: "rejects the response", req: "VRS-3" },
  "bad-shc-signature": { does: "Break the SMART Health Card signature", verifier: "sets that card aside", req: "XV-13" },
  "combine-allergies-meds": { does: "Answer allergies and medications with one shared Bundle (scenario shared-artifact)", verifier: "passes" },
};

/** Statuses an item can be forced to. */
export const STATUSES = ["fulfilled", "partial", "unavailable", "declined", "unsupported", "error"] as const;

/** Response sizes, in characters of the base64url `data.response`: what a Verifier receives. */
export const RESPONSE_SIZES: Record<string, { label: string; chars: number }> = {
  "512k": { label: "512 KB", chars: 512 * 1024 },
  "1m": { label: "1 MB", chars: 1024 * 1024 },
  "2m": { label: "2 MB", chars: 2 * 1024 * 1024 },
  "5m": { label: "5 MB", chars: 5 * 1024 * 1024 },
};

/** Synthetic patients. "aria" is the default. */
export const PATIENTS: Record<string, string> = { aria: "Aria Test", large: "Aria Test, large record" };

/** The config JSON. Every field is optional; a missing field means normal. */
export type WalletConfig = {
  faults?: string[];
  /** Item id to forced status. */
  status?: Record<string, string>;
  size?: string;
  patient?: string;
};

/** The deployed wallet's plain URL. */
export const TESTING_WALLET_URL = "https://smart-health-checkin.org/connectathon/testing-wallet/";
/** A config segment: base64url characters only. */
const SEGMENT = /^[A-Za-z0-9_-]+$/;

/** Is this the Testing Wallet's plain URL (on any host, so local builds work too)? */
export function isTestingWalletUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.pathname.endsWith("/connectathon/testing-wallet/") && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/** Drop empty fields, sort faults: one config, one URL. */
export function normalizeConfig(c: WalletConfig): WalletConfig {
  const out: WalletConfig = {};
  if (c.faults?.length) out.faults = [...new Set(c.faults)].sort();
  if (c.status && Object.keys(c.status).length) out.status = Object.fromEntries(Object.entries(c.status).sort(([a], [b]) => a.localeCompare(b)));
  if (c.size) out.size = c.size;
  if (c.patient && c.patient !== "aria") out.patient = c.patient;
  return out;
}

/** The wallet URL for a config: the plain URL for normal settings. */
export function configUrl(walletUrl: string, config: WalletConfig): string {
  const c = normalizeConfig(config);
  if (!Object.keys(c).length) return walletUrl;
  return new URL(`${base64url(JSON.stringify(c))}/`, walletUrl).href;
}

/** Check a config against this format. Returns the problems, if any, in words. */
export function configProblems(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["the config must be a JSON object"];
  const v = value as Record<string, unknown>;
  const problems: string[] = [];
  for (const k of Object.keys(v)) if (!["faults", "status", "size", "patient"].includes(k)) problems.push(`unknown field "${k}"`);
  if ("faults" in v) {
    if (!Array.isArray(v.faults)) problems.push("faults must be an array");
    else for (const f of v.faults) if (typeof f !== "string" || !(f in FAULTS)) problems.push(`unknown fault ${JSON.stringify(f)}`);
  }
  if ("status" in v) {
    if (!v.status || typeof v.status !== "object" || Array.isArray(v.status)) problems.push("status must be an object of item id to status");
    else for (const [item, s] of Object.entries(v.status)) if (!(STATUSES as readonly unknown[]).includes(s)) problems.push(`status for "${item}" must be one of ${STATUSES.join(", ")}`);
  }
  if ("size" in v && !(typeof v.size === "string" && v.size in RESPONSE_SIZES)) problems.push(`size must be one of ${Object.keys(RESPONSE_SIZES).join(", ")}`);
  if ("patient" in v && !(typeof v.patient === "string" && v.patient in PATIENTS)) problems.push(`patient must be one of ${Object.keys(PATIENTS).join(", ")}`);
  return problems;
}

/**
 * Read the config from a wallet page's path: the segment after
 * `testing-wallet/`. None means normal; a bad one is an error, in words.
 */
export function configFromPath(pathname: string): { config: WalletConfig; segment?: string } | { error: string; segment: string } {
  const segment = /\/testing-wallet\/([^/]+)\/?$/.exec(pathname)?.[1];
  if (!segment || segment === "index.html") return { config: {} };
  if (!SEGMENT.test(segment)) return { error: "the config isn't base64url", segment };
  let value: unknown;
  try {
    value = JSON.parse(fromBase64url(segment));
  } catch {
    return { error: "the config isn't base64url-encoded JSON", segment };
  }
  const problems = configProblems(value);
  return problems.length ? { error: problems.join("; "), segment } : { config: value as WalletConfig, segment };
}

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): string {
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/");
  const bytes = Uint8Array.from(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)), (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
