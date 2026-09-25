import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { selectEntries, selects, type Entry } from "../testing-wallet/src/match.ts";
import { buildQuestionnaireResponse, isEnabled, type FormState, type Questionnaire } from "../testing-wallet/src/forms.ts";

const UC = "http://hl7.org/fhir/us/core/StructureDefinition/";
const entries = (JSON.parse(readFileSync("testing-wallet/data/aria-test.json", "utf8")) as { entry: Entry[] }).entry;
const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
const types = (es: Entry[]) => es.map((e) => e.resource.resourceType);

test("exact profile: unversioned matches any version, versioned only its own", () => {
  const r = { resourceType: "AllergyIntolerance", meta: { profile: [UC + "us-core-allergyintolerance|7.0.0"] } };
  expect(selects({ kind: "selection.fhir", profiles: [UC + "us-core-allergyintolerance"] }, r)).toBe(true);
  expect(selects({ kind: "selection.fhir", profiles: [UC + "us-core-allergyintolerance|7.0.0"] }, r)).toBe(true);
  expect(selects({ kind: "selection.fhir", profiles: [UC + "us-core-allergyintolerance|6.1.0"] }, r)).toBe(false);
});

test("profilesFrom matches a family; resourceTypes narrows it", () => {
  const all = selectEntries({ kind: "selection.fhir", profilesFrom: ["http://hl7.org/fhir/us/core"] }, entries, patient.fullUrl);
  expect(all.length).toBe(entries.length);
  const obs = selectEntries({ kind: "selection.fhir", profilesFrom: ["http://hl7.org/fhir/us/core"], resourceTypes: ["Observation"] }, entries, patient.fullUrl);
  expect(new Set(types(obs))).toEqual(new Set(["Observation", "Practitioner"]));
});

test("referenced resources come along, the Patient doesn't", () => {
  const meds = selectEntries({ kind: "selection.fhir", profiles: [UC + "us-core-medicationrequest"] }, entries, patient.fullUrl);
  expect(types(meds)).toEqual(["MedicationRequest", "MedicationRequest", "MedicationRequest", "Practitioner"]);
  const cov = selectEntries({ kind: "selection.fhir", profiles: ["http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage"] }, entries, patient.fullUrl);
  expect(types(cov)).toEqual(["Coverage", "Organization"]);
});

const semaglutide = JSON.parse(readFileSync("Questionnaire/semaglutide-4-week-checkin.json", "utf8")) as Questionnaire;
const SYS = "https://smart-health-checkin.org/connectathon/CodeSystem/semaglutide-checkin";
const item = (id: string) => semaglutide.item!.find((i) => i.linkId === id)!;

test("enableWhen: the missed-dose follow-up and the call-us note appear only when they should", () => {
  const state: FormState = { questionnaire: semaglutide, answers: new Map(), prefilled: new Set() };
  expect(isEnabled(item("missed-why"), state)).toBe(false);
  state.answers.set("missed", [{ valueCoding: { system: SYS, code: "no" } }]);
  expect(isEnabled(item("missed-why"), state)).toBe(false);
  state.answers.set("missed", [{ valueCoding: { system: SYS, code: "more" } }]);
  expect(isEnabled(item("missed-why"), state)).toBe(true);
  expect(isEnabled(item("red-flags-note"), state)).toBe(false);
  state.answers.set("red-flags", [{ valueCoding: { system: SYS, code: "vision" } }]);
  expect(isEnabled(item("red-flags-note"), state)).toBe(true);
});

test("QuestionnaireResponse echoes the canonical exactly and drops hidden answers", () => {
  const state: FormState = { questionnaire: semaglutide, answers: new Map(), prefilled: new Set() };
  state.answers.set("missed", [{ valueCoding: { system: SYS, code: "no" } }]);
  state.answers.set("missed-why", [{ valueString: "left over from an earlier answer" }]);
  state.answers.set("pen-trouble", [{ valueCoding: { system: SYS, code: "site" } }, { valueString: "the cap is hard to remove" }]);
  const canonical = semaglutide.url + "|1";
  const qr = buildQuestionnaireResponse(state, canonical, patient.fullUrl) as any;
  expect(qr.questionnaire).toBe(canonical);
  const ids = qr.item.map((i: any) => i.linkId);
  expect(ids).toContain("missed");
  expect(ids).not.toContain("missed-why");
  expect(qr.item.find((i: any) => i.linkId === "pen-trouble").answer).toHaveLength(2);
});
