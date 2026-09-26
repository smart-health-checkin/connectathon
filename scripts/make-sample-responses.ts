/**
 * Writes responses/baseline-N.sample.json: the decrypted SMART response (spec
 * §6) the SMART Testing Wallet sends for Baselines 1 to 3 when the patient
 * shares everything. Built with the wallet's own matching and form code, from
 * the same patient data, so EHR developers can test parsing and display
 * without running a wallet. Rerun after changing the patient data or requests.
 */
import { validateResponseAgainstRequest } from "@smart-health-checkin/client/model";
import { readFileSync, writeFileSync } from "node:fs";
import { selectEntries, type SelectionContent } from "@smart-health-checkin/client/wallet";
import type { Entry } from "../testing-wallet/src/match.ts";
import { buildQuestionnaireResponse, type FormState, type Questionnaire } from "../testing-wallet/src/forms.ts";

const entries = (JSON.parse(readFileSync("testing-wallet/data/aria-test.json", "utf8")) as { entry: Entry[] }).entry;
const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
const bundle = (es: Entry[]) => ({ resourceType: "Bundle", type: "collection", entry: es.map((e) => ({ fullUrl: e.fullUrl, resource: e.resource })) });

for (const n of [1, 2, 3]) {
  const request = JSON.parse(readFileSync(`requests/baseline-${n}.json`, "utf8"));
  request.id = `sample-baseline-${n}`;
  const artifacts: any[] = [];
  const requestStatus: any[] = [];
  for (const item of request.items) {
    if (item.content.kind === "form.fhir") {
      const q = item.content.questionnaire as Questionnaire;
      const state: FormState = { questionnaire: q, answers: new Map(), prefilled: new Set() };
      // Sample answers: "Several days" for each question.
      for (const i of q.item ?? []) if (i.type === "choice" && i.answerOption?.[1]) state.answers.set(i.linkId, [{ valueCoding: i.answerOption[1].valueCoding! }]);
      const qr = buildQuestionnaireResponse(state, item.content.questionnaireCanonical, patient.fullUrl);
      (qr as any).authored = "2026-10-01T15:00:00Z";
      artifacts.push({ id: `qr-${item.id}`, mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [item.id], value: qr });
    } else {
      const picked = selectEntries(item.content as SelectionContent, entries, { exclude: [patient.fullUrl] }) as Entry[];
      artifacts.push({ id: `fhir-${item.id}`, mediaType: "application/fhir+json", fhirVersion: "4.0.1", fulfills: [item.id], value: bundle(picked) });
    }
    requestStatus.push({ item: item.id, status: "fulfilled" });
  }
  const response = { type: "smart-health-checkin-response", version: "1", requestId: request.id, artifacts, requestStatus };
  const check = validateResponseAgainstRequest(request, response);
  if (!check.ok) throw new Error(`baseline-${n}: ${check.error}`);
  writeFileSync(`responses/baseline-${n}.sample.json`, JSON.stringify(response, null, 2) + "\n");
  console.log(`responses/baseline-${n}.sample.json: ${artifacts.map((a) => `${a.fulfills[0]}=${a.value.resourceType === "Bundle" ? a.value.entry.map((e: any) => e.resource.resourceType).join("+") : a.value.resourceType}`).join(", ")}`);
}
