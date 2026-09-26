// Show FHIR the way an EHR would: a patient card, lists of problems,
// allergies, medications, immunizations, an insurance card, and form answers.
// Anything else is named, so nothing silently disappears.

type Res = { resourceType: string; [k: string]: any };

export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const text = (cc: any): string => cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code ?? "";
const day = (d?: string): string => (d ? d.slice(0, 10) : "");

/** Resources from an artifact value: a Bundle's entries, or the resource itself. */
export function resourcesOf(value: any): Res[] {
  if (value?.resourceType === "Bundle") return (value.entry ?? []).map((e: any) => e.resource).filter(Boolean);
  return value?.resourceType ? [value] : [];
}

const KNOWN = ["Patient", "Condition", "AllergyIntolerance", "MedicationRequest", "MedicationStatement", "Immunization", "Coverage", "Organization", "Practitioner", "QuestionnaireResponse", "Observation"];

export function readable(resources: Res[]): string {
  const of = (t: string) => resources.filter((r) => r.resourceType === t);
  const out: string[] = [];
  const list = (rows: string[]) => (rows.length ? `<div class="rows">${rows.join("")}</div>` : "");
  const row = (name: string, right: string, detail: string) =>
    `<div class="row"><span class="n">${esc(name)}</span><span class="r">${esc(right)}</span>${detail ? `<span class="d">${esc(detail)}</span>` : ""}</div>`;

  for (const p of of("Patient")) {
    const n = p.name?.[0] ?? {};
    const a = p.address?.[0] ?? {};
    out.push(`<dl class="person">
      <dt>Name</dt><dd><b>${esc([...(n.given ?? []), n.family].filter(Boolean).join(" ") || n.text)}</b></dd>
      <dt>Born</dt><dd>${esc(p.birthDate)}</dd><dt>Sex</dt><dd>${esc(p.gender)}</dd>
      <dt>Address</dt><dd>${esc([a.line?.join(", "), a.city, a.state, a.postalCode].filter(Boolean).join(", "))}</dd>
      <dt>Phone</dt><dd>${esc(p.telecom?.find((t: any) => t.system === "phone")?.value)}</dd></dl>`);
  }
  out.push(list(of("Condition").map((c) => row(text(c.code), text(c.clinicalStatus), c.onsetDateTime ? `since ${day(c.onsetDateTime)}` : ""))));
  out.push(list(of("AllergyIntolerance").map((a) => row(text(a.code), a.criticality ?? "",
    (a.reaction ?? []).flatMap((r: any) => r.manifestation ?? []).map(text).join(", ") || "no reaction recorded"))));
  out.push(list([...of("MedicationRequest"), ...of("MedicationStatement")].map((m) =>
    row(text(m.medicationCodeableConcept) || m.medicationReference?.display || "(medication)", m.status ?? "", m.dosageInstruction?.[0]?.text ?? m.dosage?.[0]?.text ?? ""))));
  out.push(list(of("Immunization").map((i) => row(text(i.vaccineCode), day(i.occurrenceDateTime), ""))));
  out.push(list(of("Observation").slice(0, 50).map((o) => row(text(o.code),
    o.valueQuantity ? `${o.valueQuantity.value} ${o.valueQuantity.unit ?? ""}` : o.valueString ?? text(o.valueCodeableConcept), day(o.effectiveDateTime)))));
  if (of("Observation").length > 50) out.push(`<p class="small">…and ${of("Observation").length - 50} more observations (see JSON).</p>`);

  for (const c of of("Coverage")) {
    const payer = resources.find((r) => r.resourceType === "Organization");
    const cls = (t: string) => c.class?.find((x: any) => x.type?.coding?.[0]?.code === t);
    out.push(`<dl class="person">
      <dt>Payer</dt><dd><b>${esc(payer?.name ?? c.payor?.[0]?.display)}</b></dd>
      <dt>Member ID</dt><dd>${esc(c.identifier?.[0]?.value ?? c.subscriberId)}</dd>
      <dt>Plan</dt><dd>${esc(cls("plan")?.name ?? cls("plan")?.value)}</dd>
      <dt>Group</dt><dd>${esc(cls("group")?.value)}</dd><dt>Status</dt><dd>${esc(c.status)}</dd></dl>`);
  }
  for (const q of of("QuestionnaireResponse")) {
    const flat = (items: any[] = []): any[] => items.flatMap((i) => [i, ...flat(i.item)]);
    const answered = flat(q.item).filter((i) => i.answer?.length);
    const answer = (a: any) => a.valueCoding?.display ?? a.valueCoding?.code ?? a.valueString ?? a.valueBoolean ?? a.valueInteger ?? a.valueDecimal ?? a.valueDate ?? "";
    out.push(`<div class="rows">${answered.map((i) => `<div class="row qa"><span class="q">${esc(i.text ?? i.linkId)}</span><span class="a">${esc(i.answer.map(answer).join(", "))}</span></div>`).join("") || `<p class="small">No answers.</p>`}</div>
      <p class="small">Form <code>${esc(q.questionnaire)}</code> · ${esc(q.status)}</p>`);
  }
  const other = resources.filter((r) => !KNOWN.includes(r.resourceType));
  const referenced = resources.filter((r) => ["Organization", "Practitioner"].includes(r.resourceType) && !of("Coverage").length);
  const extras = [...other, ...referenced];
  if (extras.length) {
    const counts = new Map<string, number>();
    for (const r of extras) counts.set(r.resourceType, (counts.get(r.resourceType) ?? 0) + 1);
    out.push(`<p class="small">Also included: ${esc([...counts].map(([t, n]) => `${n} ${t}`).join(", "))}</p>`);
  }
  return out.filter(Boolean).join("") || `<p class="small">Nothing to show.</p>`;
}
