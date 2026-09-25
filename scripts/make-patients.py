"""Writes the reference wallet's synthetic patients to testing-wallet/data/.

  aria-test.json     a modest record for the minimum scenarios (well under 512 KB)
  large-record.json  the same patient plus years of history and notes (well over 512 KB)

Each file is a FHIR R4 collection Bundle. Every resource claims the US Core
profile it is meant to satisfy, and the Coverage also claims the CARIN digital
insurance card profile. scripts/validate-fhir.sh checks them against both IGs.
"""
import base64, json, pathlib, random, uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "testing-wallet" / "data"
UC = "http://hl7.org/fhir/us/core/StructureDefinition/"
C4DIC = "http://hl7.org/fhir/us/insurance-card/StructureDefinition/"
SCT, LOINC, RX, CVX = "http://snomed.info/sct", "http://loinc.org", "http://www.nlm.nih.gov/research/umls/rxnorm", "http://hl7.org/fhir/sid/cvx"
NS = uuid.UUID("7c1d6f2e-1c2b-4a57-9a0c-5f6b0f6f9a10")
def uid(name): return f"urn:uuid:{uuid.uuid5(NS, name)}"
def cc(system, code, display, text=None):
    c = {"coding": [{"system": system, "code": code, "display": display}]}
    if text: c["text"] = text
    return c
def meta(*profiles): return {"profile": list(profiles)}

PATIENT = uid("patient")
ORG_PAYER = uid("org-payer")
PRACTITIONER = uid("practitioner")

def patient():
    return {"resourceType": "Patient", "meta": meta(UC + "us-core-patient", C4DIC + "C4DIC-Patient"),
        "extension": [
            {"url": UC + "us-core-race", "extension": [
                {"url": "ombCategory", "valueCoding": {"system": "urn:oid:2.16.840.1.113883.6.238", "code": "2106-3", "display": "White"}},
                {"url": "text", "valueString": "White"}]},
            {"url": UC + "us-core-ethnicity", "extension": [
                {"url": "ombCategory", "valueCoding": {"system": "urn:oid:2.16.840.1.113883.6.238", "code": "2186-5", "display": "Not Hispanic or Latino"}},
                {"url": "text", "valueString": "Not Hispanic or Latino"}]}],
        "identifier": [{"system": "https://smart-health-checkin.org/connectathon/patient-id", "value": "aria-test-1981"}],
        "name": [{"use": "official", "family": "Test", "given": ["Aria"]}],
        "telecom": [{"system": "phone", "value": "555-0100", "use": "mobile"}, {"system": "email", "value": "aria.test@example.org"}],
        "gender": "female", "birthDate": "1981-04-12",
        "address": [{"use": "home", "line": ["100 Example Street"], "city": "Madison", "state": "WI", "postalCode": "53703", "country": "US"}],
        "communication": [{"language": cc("urn:ietf:bcp:47", "en", "English")}]}

def condition(key, code, display, text, onset):
    return {"resourceType": "Condition", "meta": meta(UC + "us-core-condition-problems-health-concerns"),
        "clinicalStatus": cc("http://terminology.hl7.org/CodeSystem/condition-clinical", "active", "Active"),
        "verificationStatus": cc("http://terminology.hl7.org/CodeSystem/condition-ver-status", "confirmed", "Confirmed"),
        "category": [cc("http://terminology.hl7.org/CodeSystem/condition-category", "problem-list-item", "Problem List Item")],
        "code": cc(SCT, code, display, text), "subject": {"reference": PATIENT},
        "onsetDateTime": onset, "recordedDate": onset}

def allergy(system, code, display, text, reaction_code, reaction_display, criticality):
    return {"resourceType": "AllergyIntolerance", "meta": meta(UC + "us-core-allergyintolerance"),
        "clinicalStatus": cc("http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", "active", "Active"),
        "verificationStatus": cc("http://terminology.hl7.org/CodeSystem/allergyintolerance-verification", "confirmed", "Confirmed"),
        "criticality": criticality, "code": cc(system, code, display, text), "patient": {"reference": PATIENT},
        "reaction": [{"manifestation": [cc(SCT, reaction_code, reaction_display)]}]}

def med(code, display, text, dosage, authored):
    return {"resourceType": "MedicationRequest", "meta": meta(UC + "us-core-medicationrequest"),
        "status": "active", "intent": "order",
        "category": [cc("http://terminology.hl7.org/CodeSystem/medicationrequest-category", "community", "Community")],
        "medicationCodeableConcept": cc(RX, code, display, text), "subject": {"reference": PATIENT},
        "authoredOn": authored, "requester": {"reference": PRACTITIONER},
        "dosageInstruction": [{"text": dosage}]}

def immunization(code, display, date):
    return {"resourceType": "Immunization", "meta": meta(UC + "us-core-immunization"),
        "status": "completed", "vaccineCode": cc(CVX, code, display), "patient": {"reference": PATIENT},
        "occurrenceDateTime": date, "primarySource": True}

def lab(code, display, value, unit, ucum, date):
    return {"resourceType": "Observation", "meta": meta(UC + "us-core-observation-lab"),
        "status": "final", "category": [cc("http://terminology.hl7.org/CodeSystem/observation-category", "laboratory", "Laboratory")],
        "code": cc(LOINC, code, display), "subject": {"reference": PATIENT}, "effectiveDateTime": date, "performer": [{"reference": PRACTITIONER}],
        "valueQuantity": {"value": value, "unit": unit, "system": "http://unitsofmeasure.org", "code": ucum}}

VITALS = cc("http://terminology.hl7.org/CodeSystem/observation-category", "vital-signs", "Vital Signs")
def vital(profile, code, display, value, unit, ucum, date):
    return {"resourceType": "Observation", "meta": meta(UC + profile), "status": "final", "category": [VITALS],
        "code": cc(LOINC, code, display), "subject": {"reference": PATIENT}, "effectiveDateTime": date, "performer": [{"reference": PRACTITIONER}],
        "valueQuantity": {"value": value, "unit": unit, "system": "http://unitsofmeasure.org", "code": ucum}}

def bp(sys_, dia, date):
    q = lambda v: {"value": v, "unit": "mm[Hg]", "system": "http://unitsofmeasure.org", "code": "mm[Hg]"}
    return {"resourceType": "Observation", "meta": meta(UC + "us-core-blood-pressure"), "status": "final", "category": [VITALS],
        "code": cc(LOINC, "85354-9", "Blood pressure panel with all children optional"), "subject": {"reference": PATIENT}, "performer": [{"reference": PRACTITIONER}],
        "effectiveDateTime": date, "component": [
            {"code": cc(LOINC, "8480-6", "Systolic blood pressure"), "valueQuantity": q(sys_)},
            {"code": cc(LOINC, "8462-4", "Diastolic blood pressure"), "valueQuantity": q(dia)}]}

def payer_org():
    return {"resourceType": "Organization", "meta": meta(UC + "us-core-organization", C4DIC + "C4DIC-Organization"),
        "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": "1234567893"}],
        "active": True, "name": "Example Health Plan",
        "telecom": [{"system": "phone", "value": "800-555-0199", "use": "work"}],
        "address": [{"line": ["1 Plan Way"], "city": "Chicago", "state": "IL", "postalCode": "60601", "country": "US"}]}

def coverage():
    return {"resourceType": "Coverage", "meta": meta(UC + "us-core-coverage", C4DIC + "C4DIC-Coverage"),
        "identifier": [{"type": cc("http://terminology.hl7.org/CodeSystem/v2-0203", "MB", "Member Number"),
                        "system": "https://smart-health-checkin.org/connectathon/member-id", "value": "EHP123456789",
                        "assigner": {"reference": ORG_PAYER}}],
        "status": "active",
        "type": cc("https://nahdo.org/sopt", "512", "Commercial Managed Care - PPO"),
        "subscriberId": "EHP123456789", "subscriber": {"reference": PATIENT}, "beneficiary": {"reference": PATIENT},
        "relationship": cc("http://terminology.hl7.org/CodeSystem/subscriber-relationship", "self", "Self"),
        "period": {"start": "2026-01-01", "end": "2026-12-31"},
        "payor": [{"reference": ORG_PAYER}],
        "class": [
            {"type": cc("http://terminology.hl7.org/CodeSystem/coverage-class", "group", "Group"), "value": "GRP-4400", "name": "Example Co. employees"},
            {"type": cc("http://terminology.hl7.org/CodeSystem/coverage-class", "plan", "Plan"), "value": "PPO-GOLD", "name": "Gold PPO"}]}

def practitioner():
    return {"resourceType": "Practitioner", "meta": meta(UC + "us-core-practitioner"),
        "identifier": [{"system": "http://hl7.org/fhir/sid/us-npi", "value": "1144221847"}],
        "name": [{"family": "Rivera", "given": ["Dana"], "prefix": ["Dr."]}]}

def base_record():
    return [
        (PATIENT, patient()),
        (PRACTITIONER, practitioner()),
        (ORG_PAYER, payer_org()),
        (uid("cond-t2dm"), condition("t2dm", "44054006", "Diabetes mellitus type 2", "Type 2 diabetes", "2019-03-02")),
        (uid("cond-obesity"), condition("obesity", "414916001", "Obesity", "Obesity", "2017-06-20")),
        (uid("cond-htn"), condition("htn", "59621000", "Essential hypertension", "High blood pressure", "2020-09-14")),
        (uid("allergy-pcn"), allergy(RX, "7980", "penicillin G", "Penicillin", "126485001", "Urticaria", "low")),
        (uid("allergy-peanut"), allergy(SCT, "762952008", "Peanut", "Peanuts", "39579001", "Anaphylaxis", "high")),
        (uid("med-metformin"), med("860975", "24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet", "Metformin ER 500 mg", "Take 2 tablets by mouth once daily with dinner.", "2019-03-02")),
        (uid("med-lisinopril"), med("314076", "lisinopril 10 MG Oral Tablet", "Lisinopril 10 mg", "Take 1 tablet by mouth once daily.", "2020-09-14")),
        (uid("med-semaglutide"), med("1991302", "semaglutide", "Semaglutide (Ozempic) 0.25 mg weekly", "Inject 0.25 mg under the skin once weekly for 4 weeks, then 0.5 mg weekly.", "2026-08-28")),
        (uid("imm-flu"), immunization("140", "Influenza, split virus, trivalent, PF", "2025-10-03")),
        (uid("imm-covid"), immunization("213", "SARS-COV-2 (COVID-19) vaccine, UNSPECIFIED", "2025-10-03")),
        (uid("imm-tdap"), immunization("115", "Tdap", "2021-05-18")),
        (uid("obs-a1c"), lab("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", 7.8, "%", "%", "2026-08-20")),
        (uid("obs-weight"), vital("us-core-body-weight", "29463-7", "Body weight", 104.3, "kg", "kg", "2026-08-28")),
        (uid("obs-bmi"), vital("us-core-bmi", "39156-5", "Body mass index (BMI) [Ratio]", 37.2, "kg/m2", "kg/m2", "2026-08-28")),
        (uid("obs-bp"), bp(134, 84, "2026-08-28")),
        (uid("coverage"), coverage()),
    ]

def finish(r):
    # CARIN's profiles require meta.lastUpdated; set it everywhere for consistency.
    return {**r, "meta": {**r.get("meta", {}), "lastUpdated": "2026-09-25T12:00:00Z"}}
def bundle(entries):
    return {"resourceType": "Bundle", "type": "collection", "entry": [{"fullUrl": u, "resource": finish(r)} for u, r in entries]}

def large_record():
    entries = base_record()
    rnd = random.Random(1981)
    note_text = ("Follow-up visit. Patient reports steady progress on diet and exercise. "
                 "Reviewed home glucose log, medication adherence, and foot care. "
                 "Discussed sleep, stress, and plans for the coming months. ") * 40
    for i in range(400):
        year, month = 2014 + i // 36, 1 + (i % 12)
        date = f"{year}-{month:02d}-{1 + rnd.randrange(27):02d}"
        entries.append((uid(f"a1c-{i}"), lab("4548-4", "Hemoglobin A1c/Hemoglobin.total in Blood", round(6.2 + rnd.random() * 2.5, 1), "%", "%", date)))
        entries.append((uid(f"bp-{i}"), bp(118 + rnd.randrange(30), 72 + rnd.randrange(18), date)))
        if i % 4 == 0:
            entries.append((uid(f"note-{i}"), {
                "resourceType": "DocumentReference", "meta": meta(UC + "us-core-documentreference"),
                "status": "current", "type": cc(LOINC, "11506-3", "Progress note"),
                "category": [cc("http://hl7.org/fhir/us/core/CodeSystem/us-core-documentreference-category", "clinical-note", "Clinical Note")],
                "subject": {"reference": PATIENT}, "date": f"{date}T10:00:00Z", "author": [{"reference": PRACTITIONER}],
                "content": [{"attachment": {"contentType": "text/plain", "data": base64.b64encode(note_text.encode()).decode()}}],
                "context": {"period": {"start": date}}}))
    return entries

OUT.mkdir(parents=True, exist_ok=True)
for name, entries in [("aria-test.json", base_record()), ("large-record.json", large_record())]:
    text = json.dumps(bundle(entries), indent=1, ensure_ascii=False) + "\n"
    (OUT / name).write_text(text)
    print(f"{name}: {len(entries)} resources, {len(text.encode()) // 1024} KB")
