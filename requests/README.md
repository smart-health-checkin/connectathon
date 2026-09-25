# Requests

Every baseline and optional-scenario request from the [scenarios](../), as SMART Health Check-in request JSON ([spec §5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model)).

Each file's `id` is `replace-with-a-unique-id`. Your EHR must send a fresh, unique `id` with every request, and the wallet echoes it back as `requestId`.

"Try in the reference EHR" opens the client library's demo check-in page with that request and the event wallet registry loaded.

| Scenario | File |
|---|---|
| Baseline 1: demographics and PAMI (M1, M2, M5) | `baseline-1.json` |
| Baseline 2: demographics and insurance (M3, M6) | `baseline-2.json` |
| Baseline 3: demographics and PHQ-2 (M4) | `baseline-3.json` |
| Baseline 4: anything in USCDI (L1, L2) | `baseline-4.json` |
| O1 Questionnaire by reference only | `o1-questionnaire-by-reference.json` |
| O2 Versioned canonical | `o2-versioned-canonical.json` |
| O3 Physician-authored form | `o3-physician-authored-form.json` |
| O4 Narrowed family | `o4-narrowed-family.json` |
| O5 No selector | `o5-no-selector.json` |
| O6 SMART Health Card | `o6-smart-health-card.json` |
| O7 One artifact, several items | uses `baseline-1.json` |
| O8 Cross-device, O9 in-person handoff | use `baseline-1.json` |
| O12 Unknown selector | `o12-unknown-selector.json` |

O12 carries an extension selector kind that no wallet will recognize, on purpose. A wallet should answer that item `unsupported` and still answer the others ([§5.4.3](https://smart-health-checkin.org/spec/#5-4-3-extension-selectors)).
