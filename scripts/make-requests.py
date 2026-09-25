"""Regenerates requests/*.json. Inline questionnaires are copied from
Questionnaire/, so rerun this after editing a Questionnaire; the build fails
if an inline copy drifts from the hosted one."""
import json, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
UC = "http://hl7.org/fhir/us/core/StructureDefinition/"
QB = "https://smart-health-checkin.org/connectathon/Questionnaire/"
FJ = ["application/fhir+json"]
RID = "replace-with-a-unique-id"

def sel(id, title, profiles=None, summary=None, accept=FJ, **extra):
    c = {"kind": "selection.fhir"}
    if profiles: c["profiles"] = profiles
    c.update(extra)
    it = {"id": id, "title": title}
    if summary: it["summary"] = summary
    it["content"] = c; it["accept"] = accept
    return it

def q(file): return json.loads((ROOT / "Questionnaire" / file).read_text())

def form(id, title, file, inline=True, canonical=None, required=True, summary=None):
    c = {"kind": "form.fhir", "questionnaireCanonical": canonical or QB + file}
    if inline: c["questionnaire"] = q(file)
    it = {"id": id, "title": title}
    if summary: it["summary"] = summary
    if required: it["required"] = True
    it["content"] = c; it["accept"] = FJ
    return it

def req(items, purpose="Pre-visit check-in"):
    return {"type": "smart-health-checkin-request", "version": "1", "id": RID, "purpose": purpose, "fhirVersions": ["4.0.1"], "items": items}

patient = sel("patient", "Demographics", [UC + "us-core-patient"])
files = {
    "baseline-1.json": req([patient,
        sel("problems", "Problems and health concerns", [UC + "us-core-condition-problems-health-concerns"]),
        sel("allergies", "Allergies", [UC + "us-core-allergyintolerance"]),
        sel("medications", "Medications", [UC + "us-core-medicationrequest"]),
        sel("immunizations", "Immunizations", [UC + "us-core-immunization"])]),
    "baseline-2.json": req([patient,
        sel("coverage", "Insurance", ["http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage", UC + "us-core-coverage"],
            summary="Your insurance card, as a CARIN digital insurance card or US Core coverage record.",
            accept=["application/fhir+json", "application/smart-health-card"])]),
    "baseline-3.json": req([patient, form("phq2", "Two questions about your mood", "phq-2.json")]),
    "baseline-4.json": req([sel("uscdi", "Your health record", None,
        summary="Any US Core data you choose to share: problems, medications, allergies, results, immunizations, coverage, notes, and so on.",
        profilesFrom=["http://hl7.org/fhir/us/core"])]),
    "o1-questionnaire-by-reference.json": req([form("gad7", "Questions about worry and anxiety", "gad-7.json", inline=False)]),
    "o2-versioned-canonical.json": req([form("phq2", "Two questions about your mood", "phq-2.json", canonical=QB + "phq-2.json|1")]),
    "o3-physician-authored-form.json": req([form("semaglutide", "How your new medicine is going", "semaglutide-4-week-checkin.json", required=False,
        summary="A short check-in from your doctor about the semaglutide shots you started about a month ago.")]),
    "o4-narrowed-family.json": req([sel("labs-vitals", "Recent lab results and vitals", None,
        summary="Recent lab results and vital signs.", profilesFrom=["http://hl7.org/fhir/us/core"], resourceTypes=["Observation"])]),
    "o5-no-selector.json": req([{"id": "anything", "title": "Anything you'd like your doctor to see",
        "summary": "Share whatever you think is relevant to this visit.", "content": {"kind": "selection.fhir"}, "accept": FJ}]),
    "o6-smart-health-card.json": req([sel("immunizations", "Immunization record", [UC + "us-core-immunization"],
        accept=["application/smart-health-card", "application/fhir+json"])]),
    "o12-unknown-selector.json": req([patient, {"id": "mystery", "title": "A test item your app won't recognize",
        "content": {"kind": "example.ktc-test"}, "accept": FJ}]),
}
for name, obj in files.items():
    (ROOT / "requests" / name).write_text(json.dumps(obj, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {len(files)} request files")
