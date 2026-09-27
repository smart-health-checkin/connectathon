// The testing panel's response-size setting: grow one requested item's Bundle
// with earlier records of the same kinds until the encoded response reaches
// about the chosen size. It tests that large responses work end to end.
import type { SmartArtifact, SmartCheckinResponse } from "@smart-health-checkin/client";
import type { Entry, Resource } from "./match.ts";

import { RESPONSE_SIZES } from "./config.ts";
export { RESPONSE_SIZES };

/** Resources that support a record (a reference target) rather than being one. Never copied. */
const SUPPORTING = new Set(["Patient", "Practitioner", "PractitionerRole", "Organization", "Location", "Medication"]);
/** Which item to grow, best first: a history of these reads like a real record. */
const PREFERRED = ["Observation", "MedicationRequest", "Immunization", "Condition", "Procedure", "DiagnosticReport"];
const DATE_FIELDS = ["effectiveDateTime", "issued", "authoredOn", "occurrenceDateTime", "recordedDate", "onsetDateTime", "performedDateTime", "date"];
const DAY = 86_400_000;

export type Grown = { artifactId: string; item: string; added: number; types: string };

export function formatSize(chars: number): string {
  return chars < 1024 * 1024 ? `${(chars / 1024).toFixed(1)} KB` : `${(chars / 1024 / 1024).toFixed(2)} MB`;
}

type Bundle = { resourceType: "Bundle"; entry: { fullUrl: string; resource: Resource }[] };
const isBundle = (a: SmartArtifact): a is SmartArtifact & { value: Bundle } =>
  a.mediaType === "application/fhir+json" && (a.value as { resourceType?: string })?.resourceType === "Bundle";
const records = (b: Bundle) => b.entry.filter((e) => !SUPPORTING.has(e.resource.resourceType));
const rankOf = (type: string) => (PREFERRED.includes(type) ? PREFERRED.indexOf(type) : PREFERRED.length);
/** The records to copy: those of the best-ranked kind in PREFERRED, or all of them if none is. */
function toCopy(b: Bundle) {
  const rs = records(b);
  const best = Math.min(...rs.map((e) => rankOf(e.resource.resourceType)));
  return best < PREFERRED.length ? rs.filter((e) => rankOf(e.resource.resourceType) === best) : rs;
}

/** The FHIR Bundle artifact to grow: the one whose records rank best in PREFERRED, then the largest. */
export function pickArtifact(response: SmartCheckinResponse): (SmartArtifact & { value: Bundle }) | undefined {
  const rank = (a: SmartArtifact & { value: Bundle }) => {
    const types = records(a.value).map((e) => e.resource.resourceType);
    return [Math.min(...types.map(rankOf)), -types.length] as const;
  };
  return response.artifacts
    .filter(isBundle)
    .filter((a) => records(a.value).length > 0)
    .sort((x, y) => { const [a1, a2] = rank(x), [b1, b2] = rank(y); return a1 - b1 || a2 - b2; })[0];
}

/**
 * Add earlier copies of the artifact's records of one kind (see PREFERRED) until its JSON has grown by
 * about `extraChars`: new ids, dates stepped back, a finished status for past
 * prescriptions, and lab and vital values varied a little. Returns the new
 * entries; the caller puts them in the Bundle.
 */
export function earlierRecords(bundle: Bundle, extraChars: number): Entry[] {
  const originals = toCopy(bundle);
  const roundChars = originals.reduce((n, e) => n + JSON.stringify(e).length + 1, 0);
  const rounds = Math.max(1, Math.ceil(extraChars / roundChars));
  // Spread the history over about ten years, at most one round a day.
  const step = Math.max(1, Math.floor(3650 / rounds)) * DAY;
  const added: Entry[] = [];
  let grown = 0;
  for (let k = 1; grown < extraChars; k++) {
    for (const e of originals) {
      if (grown >= extraChars) break;
      const entry = earlier(e, k, k * step);
      added.push(entry);
      grown += JSON.stringify(entry).length + 1;
    }
  }
  return added;
}

function earlier(e: Entry, k: number, backMs: number): Entry {
  const r = structuredClone(e.resource) as Record<string, any>;
  const id = crypto.randomUUID();
  r.id = id;
  for (const f of DATE_FIELDS) if (typeof r[f] === "string") r[f] = shift(r[f], backMs);
  if (r.effectivePeriod?.start) r.effectivePeriod.start = shift(r.effectivePeriod.start, backMs);
  if (r.effectivePeriod?.end) r.effectivePeriod.end = shift(r.effectivePeriod.end, backMs);
  if (r.resourceType === "MedicationRequest") r.status = "completed";
  const vary = (q: { value?: unknown } | undefined) => {
    if (!q || typeof q.value !== "number") return;
    const decimals = (String(q.value).split(".")[1] ?? "").length;
    const factor = 1 + 0.06 * Math.sin(k * 1.7 + q.value); // within ±6%, repeatable
    q.value = Number((q.value * factor).toFixed(decimals));
  };
  vary(r.valueQuantity);
  for (const c of r.component ?? []) vary(c.valueQuantity);
  return { fullUrl: `urn:uuid:${id}`, resource: r as Resource };
}

function shift(value: string, backMs: number): string {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return value;
  const iso = new Date(t - backMs).toISOString();
  return value.length === 10 ? iso.slice(0, 10) : value.length === 7 ? iso.slice(0, 7) : value.length === 4 ? iso.slice(0, 4) : iso.replace(".000Z", "Z");
}
