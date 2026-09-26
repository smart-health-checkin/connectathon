# SMART Health Check-in connectathon: test scenarios

<p class="draft"><b>Draft.</b> The event date isn't set yet, so dates below are marked <code>{{TBD: …}}</code>. Everything else linked here is live. Components marked "not yet" in the <a href="directory.html">directory</a> aren't ready for testing.</p>

KTC pre-visit check-in connectathon, {{TBD: event date and time}}, about 3 hours, on Zoom: {{TBD: Zoom link}}.

Spec: [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/). Section links below go to that page.
Event resources: <https://smart-health-checkin.org/connectathon/>, published from the [`smart-health-checkin/connectathon`](https://github.com/smart-health-checkin/connectathon) repository. The URLs below are where each resource will live. Items still marked `{{TBD: …}}` will be filled in as they are set up.

## Timeline

- **{{TBD: date, 3 weeks before}}:** reference implementations, test tools, the wallet registry, example questionnaires, and baseline requests are live.
- **{{TBD: date, 1 week before}}:** aim to have your component up for self-serve testing and to have tried a first connection.
- **The event:** ideally spent on the harder problems and live debugging. We expect some people will still be finishing basic setup, and that's fine.

## Roles

There are three kinds of participant. Each one's steps are below, with links to the spec sections that define them. The exact identifiers and message formats are in the expandable reference under each role.

### EHR

The practice system. Its check-in page builds a request, lets the patient choose a wallet, and handles the response in the same page.

1. **Build the request.** A small JSON document listing the items you want: records by FHIR profile, or a form to fill in. ([§5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model))
2. **Wrap it and create a one-time key.** The request goes inside an mdoc request, and the page makes a fresh encryption key for the answer. ([§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction))
3. **Send it to the wallet the patient picked.** A native wallet goes through the browser's Digital Credentials API. A web wallet goes through the [web wallet hand-off](#web-wallet). ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers))
4. **Decrypt the answer and check its signatures.** ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing), [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist))
5. **Check the answer against the request, then show it to staff.** ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation))

The [client library](https://smart-health-checkin.org/client/) does steps 2 to 5 for JavaScript pages: drop in `<smart-checkin-picker>`, or call `runCheckin`. Install it from GitHub with `npm install github:smart-health-checkin/client`.

<details>
<summary>Reference: identifiers and checks for EHR developers</summary>

| What | Value | Spec |
|---|---|---|
| Request fields | `type`, `version`, `id`, `items[]`. Each item has `id`, `title`, `content`, `accept[]`. | [§5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model) |
| Where the request goes | `ItemsRequest.requestInfo["org.smarthealthit.checkin.request"]`, as a JSON string | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| mdoc `docType` | `org.smarthealthit.checkin.1` | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| mdoc namespace and element | `org.smarthealthit.checkin`, `smart_health_checkin_response` | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| `DeviceRequest` | version `1.0`, with the `ItemsRequest` tag-24 wrapped | [A.3](https://smart-health-checkin.org/spec/#a-3-devicerequest-docrequest-and-tag-24-itemsrequest) |
| Encryption | a fresh P-256 HPKE key per request, sent in a CBOR `encryptionInfo` with a nonce | [§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction) |
| Digital Credentials API argument | `{ protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }` | [A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers) |
| Session transcript | built from the exact `encryptionInfo` string and the page's origin | [§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript) |
| Response checks | HPKE opens; `DeviceResponse` version and status; issuer signature; device signature; value digest | [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist) |
| Cross-checks | `requestId` matches; one status per item; every artifact's media type accepted by the items it fulfills | [§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation) |

</details>

### Native wallet

A health app installed on the phone. The browser passes it the EHR's request through the Digital Credentials API, and the phone shows it as a choice to the patient. On Android, the app registers with Credential Manager, and a small matcher decides whether it can answer a request.

1. **Check the request.** ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction))
2. **Ask the patient, item by item.** `required: true` is the clinic's advice, not consent.
3. **Build the answer**, with one status per item and the records or form answers the patient chose. ([§6.1](https://smart-health-checkin.org/spec/#6-1-normative-typescript-model), [§6.2](https://smart-health-checkin.org/spec/#6-2-artifact-and-status-semantics))
4. **Sign and encrypt it for the EHR**, bound to the origin the phone reports. ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction), [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing))

<details>
<summary>Reference: what the wallet checks and produces</summary>

| What | Detail | Spec |
|---|---|---|
| Request checks | the `DeviceRequest`, the tag-24 `ItemsRequest`, the request carrier, and the SMART request inside it | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Origin | taken from the platform, never from the request | [§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript) |
| Response location | the SMART response JSON as an issuer-signed item, element `smart_health_checkin_response` | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Signatures | issuer signature over the MSO; device signature over the session | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Encryption | HPKE to the EHR's key from `encryptionInfo`, with the session transcript as `info` | [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing) |

</details>

### Web wallet

A health app that runs as a website. It does the same work as a native wallet, but the EHR reaches it by opening it in a tab instead of through the Digital Credentials API. The two pages exchange three messages:

1. **Ready.** The wallet tells the EHR page it has loaded.
2. **Request.** The EHR page sends the same request a native wallet would get.
3. **Response.** The wallet sends back the same encrypted answer a native wallet would return, or says the patient declined or something failed.

The wallet learns which page is asking from the browser (`event.origin`), never from the message itself. It shows that origin to the patient and binds the answer to it. ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript))

<details>
<summary>Reference: the three messages</summary>

Ready, from the wallet to its opener:

```js
{ type: "digital-credentials/web-wallet/ready" }
```

Request, from the EHR page to the wallet's origin:

```js
{
  type: "digital-credentials/web-wallet/request",
  requestId: "<opaque>",
  credentialRequestOptions: {
    digital: { requests: [{ protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }] }
  }
}
```

Response, from the wallet to the EHR page's origin:

```js
{
  type: "digital-credentials/web-wallet/response",
  requestId: "<same as the request>",
  outcome: "approved",   // or "declined", or "error" with a message
  credential: { protocol: "org-iso-mdoc", data: { response } }
}
```

</details>

The full hand-off, with timeouts and a checklist, is at <https://smart-health-checkin.org/connectathon/web-wallet-handoff.html>.

## How we'll work together

- **Make your component self-serve.** Put up something anyone can test against without you in the room, and list it in the [participant directory](#shared-resources):
  - EHR: a public check-in page URL.
  - Web wallet: an entry in the [registry](#wallet-registry).
  - Native wallet: an install link and the name of its test patient.
- **Test early.** Self-serve testing in the week before the event leaves the live session for problems that need two people.
- **Main room plus your own breakout rooms.** The event runs in one Zoom meeting.
  - Kickoff, check-ins, and the report-out happen in the main room.
  - Two people debugging together: start a Slack huddle in a direct message. It has video and screen sharing.
  - A group, or someone not on the Slack: open `https://meet.jit.si/ktc-checkin-<ehr>-<wallet>` and post the link in `#kill-the-clipboard`.
- **Try to test with every counterpart** over the course of the event.
- **Record failures as well as passes** by [filing a result](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml). A failure often points to a spec gap or an interop bug, and its issue is where it gets discussed.
- **Synthetic data only.** Never use real patient records, even your own.

## Technical ground rules

- **Open trust.** Wallets accept any EHR origin and do not require reader authentication. EHRs accept responses from any wallet. There are no certificates or trust lists ([§7](https://smart-health-checkin.org/spec/#7-trust-framework)).
- **No patient matching.** Each wallet holds its own synthetic patient. EHRs display what arrives and do not match it to a chart.
- **Handoff is a plain link.** The patient opens the EHR's check-in page in a browser. Portal buttons, SMS, and QR codes are product choices outside the spec ([§1.3](https://smart-health-checkin.org/spec/#1-3-handoffs-as-on-ramps)).
- **Bring your own devices.** Native-wallet testing needs an Android phone with Chrome, or an iPhone with Safari 26, with a wallet installed. There is a [reference Android wallet](#reference-android-wallet). There is no reference iOS wallet, so iOS testing uses participants' own wallets.
- **Small responses first.** Every minimum scenario stays under 512 KB per response, so size limits in browsers and phone APIs don't get in the way of the basics. Larger payloads have their own scenarios.
- **FHIR R4 and US Core.** Requests use `fhirVersions: ["4.0.1"]` and `accept: ["application/fhir+json"]`. The insurance item also accepts a SMART Health Card ([§5.6](https://smart-health-checkin.org/spec/#5-6-accepted-media-types)).

## Shared resources

All under <https://smart-health-checkin.org/connectathon/>.

| Resource | Link |
|---|---|
| Participant directory: your check-in URL, install link, or registry entry, and your test patient | <https://smart-health-checkin.org/connectathon/directory.html>. Register with the [registration form](https://smart-health-checkin.org/connectathon/register/), which opens a pull request for you. |
| Test results: one GitHub issue per run, filed through a form | [file a result](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml); all results at <https://smart-health-checkin.org/connectathon/results.html> |
| Wallet registry | <https://smart-health-checkin.org/connectathon/wallets.json> |
| Web wallet hand-off | <https://smart-health-checkin.org/connectathon/web-wallet-handoff.html> |
| Baseline and scenario requests | <https://smart-health-checkin.org/connectathon/requests/> |
| Example questionnaires | <https://smart-health-checkin.org/connectathon/Questionnaire/> |
| Reference EHR check-in page | <https://smart-health-checkin.org/client/demo/>. Load the event registry with [this link](https://smart-health-checkin.org/client/demo/#wallets=https%3A%2F%2Fsmart-health-checkin.org%2Fconnectathon%2Fwallets.json). |
| Sample responses: what a wallet sends for Baselines 1 to 3, decrypted | <https://smart-health-checkin.org/connectathon/responses/> |
| Reference Android wallet | [download](https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-checkin-wallet-debug.apk), see [below](#reference-android-wallet) |
| Testing EHR | <https://smart-health-checkin.org/connectathon/testing-ehr/> |
| SMART Testing Wallet: the reference web wallet, also usable for fault testing | <https://smart-health-checkin.org/connectathon/testing-wallet/>, also in the registry. [What it does](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md). |
| Chat for questions and pairing | `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)) |

### Wallet registry

The event registry lists every participating web wallet, at <https://smart-health-checkin.org/connectathon/wallets.json>. It uses the format the client library reads ([wallet registries](https://smart-health-checkin.org/client/docs/registry.html)):

```json
{
  "source": "KTC connectathon, October 2026",
  "wallets": [
    {
      "id": "example",
      "name": "Example Health App",
      "walletUrl": "https://example.org/checkin-wallet",
      "description": "Web wallet with synthetic patient Jane Test.",
      "homepage": "https://example.org",
      "iconUrl": "https://example.org/icon.png",
      "target": "tab"
    }
  ]
}
```

You don't edit this file directly. Add your web wallet on the [registration form](https://smart-health-checkin.org/connectathon/register/), which fills in every registry field and opens a pull request with your organization's participant file. The registry is regenerated from those files ([details](https://github.com/smart-health-checkin/connectathon/blob/main/CONTRIBUTING.md)).

The list will change during testing. EHRs should load it from the registry URL each time the check-in page opens, or sync it automatically, so changes need no redeploy.

### Example questionnaires

There is no single intake form for this event. These examples give EHRs something realistic to send and wallets something realistic to render. Each is hosted as a FHIR Questionnaire whose `url` is its hosted address, so a wallet can also fetch it by reference ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)).

| Form | Kind | Link |
|---|---|---|
| PHQ-2 depression screen, 2 questions | Standard screening instrument, used in Baseline 3 | <https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json> |
| GAD-7 anxiety screen, 7 questions | Standard screening instrument | <https://smart-health-checkin.org/connectathon/Questionnaire/gad-7.json> |
| Semaglutide 4-week check-in, 13 questions | Written by a physician for patients starting this one medication | <https://smart-health-checkin.org/connectathon/Questionnaire/semaglutide-4-week-checkin.json> |

The semaglutide form asks only what the patient's record can't answer: how the weekly shots are going, missed doses, pen problems, nausea and other side effects, warning symptoms, and readiness to step up the dose. It uses integer, yes/no, single-choice, check-all-that-apply, and free-text items. One question accepts both checked options and the patient's own words. Two items appear only when an earlier answer calls for them. No item is required.

## Baseline requests

EHRs should be able to send Baselines 1 to 3, and wallets should be able to answer them with responses under 512 KB. Baseline 4 is for the larger-data scenarios. Each is published at `https://smart-health-checkin.org/connectathon/requests/baseline-N.json`. `…` stands for `http://hl7.org/fhir/us/core/StructureDefinition`.

**Baseline 1: demographics and PAMI** (problems, allergies, medications, immunizations)

| Item id | Title | Selector ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)) |
|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` |
| `problems` | Problems and health concerns | `profiles: ["…/us-core-condition-problems-health-concerns"]` |
| `allergies` | Allergies | `profiles: ["…/us-core-allergyintolerance"]` |
| `medications` | Medications | `profiles: ["…/us-core-medicationrequest"]` |
| `immunizations` | Immunizations | `profiles: ["…/us-core-immunization"]` |

**Baseline 2: demographics and insurance**

| Item id | Title | Selector | Accept |
|---|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` | `application/fhir+json` |
| `coverage` | Insurance | `profiles: ["http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage", "…/us-core-coverage"]` | `application/fhir+json`, `application/smart-health-card` |

The two coverage profiles are alternatives: a wallet may hold the CARIN digital insurance card, US Core Coverage, or both ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)).

**Baseline 3: demographics and a pre-visit questionnaire**

| Item id | Title | Selector |
|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` |
| `phq2` | Two questions about your mood | `form.fhir` with the PHQ-2 Questionnaire inline and its `questionnaireCanonical` ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)) |

**Baseline 4: anything in USCDI**

| Item id | Title | Selector |
|---|---|---|
| `uscdi` | Your health record | `profilesFrom: ["http://hl7.org/fhir/us/core"]`: any resource conforming to a US Core profile |

All canonicals are unversioned, so any US Core version matches ([§5.5](https://smart-health-checkin.org/spec/#5-5-canonical-version-handling)). Baseline 3 in full:

```json
{
  "type": "smart-health-checkin-request",
  "version": "1",
  "id": "ktc-baseline-3-<unique>",
  "purpose": "Pre-visit check-in",
  "fhirVersions": ["4.0.1"],
  "items": [
    {
      "id": "patient",
      "title": "Demographics",
      "content": {
        "kind": "selection.fhir",
        "profiles": ["http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient"]
      },
      "accept": ["application/fhir+json"]
    },
    {
      "id": "phq2",
      "title": "Two questions about your mood",
      "required": true,
      "content": {
        "kind": "form.fhir",
        "questionnaireCanonical": "https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json",
        "questionnaire": {
          "resourceType": "Questionnaire",
          "url": "https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json",
          "…": "…"
        }
      },
      "accept": ["application/fhir+json"]
    }
  ]
}
```

## Minimum scenarios

Use Baselines 1 to 3, with responses under 512 KB. Run them for every EHR and wallet pairing you can reach.

### M1. Web wallet from the registry

1. The EHR loads the registry and shows every listed wallet, with the phone's own wallet alongside.
2. The tester picks a web wallet. The EHR opens it and sends Baseline 1 through the [hand-off](#web-wallet).
3. In the wallet, the tester shares everything.
4. The response arrives back in the EHR's page.

Pass:
- **EHR:** the response opens and verifies ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing), [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist)), passes cross-validation ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation)), and the page shows each item's status and data.
- **Wallet:** shows the EHR's origin during consent, returns `fulfilled` for each item, and the returned resources carry the matching US Core `meta.profile`.

### M2. Native wallet through the Digital Credentials API

Same as M1, but the tester picks the phone's own wallet, and the EHR calls `navigator.credentials.get` ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers)). Record the phone, OS version, browser, and wallet app.

### M3. Insurance

Baseline 2, through either path.

Pass: the EHR displays the member, payer, and plan from the returned Coverage, whichever profile or format the wallet chose. If the wallet returns a SMART Health Card, the EHR verifies its signature before showing it.

### M4. Pre-visit questionnaire, inline

Baseline 3, through either path.

Pass:
- **Wallet:** renders the inline PHQ-2 and returns a QuestionnaireResponse whose `questionnaire` is exactly the requested canonical ([§5.5](https://smart-health-checkin.org/spec/#5-5-canonical-version-handling)).
- **EHR:** shows each answer next to its question.

### M5. One item declined

Baseline 1. In the wallet, decline `immunizations` and share the rest.

Pass:
- **Wallet:** returns `declined` for `immunizations`, and exactly one status for every other item ([§6.2](https://smart-health-checkin.org/spec/#6-2-artifact-and-status-semantics)).
- **EHR:** shows the declined item as declined, not as an error, and displays the rest normally.

### M6. Nothing to share

The tester declines the whole request, or uses a wallet whose patient has no insurance on file.

Pass: the EHR handles a whole-request decline and an `unavailable` item without breaking the page, and the patient can continue without the wallet.

## Larger data scenarios

Baseline 4, kept separate so size limits don't block the minimum scenarios.

| # | Scenario | Pass |
|---|---|---|
| L1 | Anything in USCDI, small patient: a modest record, under 512 KB | The EHR shows every returned resource under `uscdi`, whatever the resource types. The wallet lets the patient choose what to include ([§5.4](https://smart-health-checkin.org/spec/#5-4-content-selectors)). |
| L2 | Anything in USCDI, large patient: a full history with notes, well over 512 KB | The response arrives intact. On Android, this needs Chrome 150 or later and a wallet that uses the large-payload response API; with older Chrome, responses over about 520 KB are dropped silently and the page waits forever. Record the browser, phone, and wallet version. |

## Optional and stretch scenarios

| # | Scenario | What it adds | Pass |
|---|---|---|---|
| O1 | Questionnaire by reference only | `form.fhir` with `questionnaireCanonical` and no inline body. The wallet fetches the hosted form ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)). | Wallet renders the fetched form, or reports `unsupported` rather than inventing one. |
| O2 | Versioned canonical | `questionnaireCanonical` with a version suffix, such as …/phq-2.json&#124;1, body inline | Wallet echoes the versioned canonical exactly in `QuestionnaireResponse.questionnaire` ([§5.5](https://smart-health-checkin.org/spec/#5-5-canonical-version-handling)). |
| O3 | Physician-authored form | The semaglutide check-in form, inline | Wallet renders every item type, shows the missed-dose follow-up and the call-us note only when their conditions are met, accepts typed answers on the pen question, and returns every answer given. |
| O4 | Narrowed family | `profilesFrom` US Core plus `resourceTypes: ["Observation"]`, for recent labs and vitals ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)) | Only Observations come back. |
| O5 | No selector | `selection.fhir` with no arrays, meaning whatever the patient thinks is relevant ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)) | Wallet lets the patient choose, and the EHR displays whatever arrives. |
| O6 | SMART Health Card | `accept: ["application/smart-health-card", "application/fhir+json"]` for immunizations | EHR verifies the card's signature and shows its contents. |
| O7 | One artifact, several items | Wallet answers `allergies` and `medications` with one Bundle whose `fulfills[]` lists both ([§6.3](https://smart-health-checkin.org/spec/#6-3-many-to-many-fulfillment)) | EHR attributes the resources to both items without double-counting. |
| O8 | Cross-device | Desktop Chrome or Safari 26 sends Baseline 1 and shows a QR code, and the phone's wallet answers | Response arrives in the desktop page. |
| O9 | In-person handoff | A front-desk QR code or kiosk lands the patient's phone on the EHR's check-in page | Same as M2, with the handoff shown. |
| O10 | Prefilled form | Wallet prefills answers it can from the patient's records and lets the patient edit | Prefilled answers are visible to the patient before sending. |
| O11 | Write back | EHR files returned data or answers into the chart after staff review | Staff can accept or reject each item. |
| O12 | Unknown selector | An item with `kind: "example.ktc-test"` ([§5.4.3](https://smart-health-checkin.org/spec/#5-4-3-extension-selectors)) | Wallet reports `unsupported` for that item and still answers the others. |

## Testing EHR and testing wallet

Two test tools let each participant run the scenarios above against a known-good counterpart without waiting for a partner.

- **[Testing EHR](https://smart-health-checkin.org/connectathon/testing-ehr/)**
  - Sends any scenario's request to any registry wallet, or to the phone's own wallet.
  - Checks the response against the spec, each check linked to its requirement. The verdict says whether the response was rejected, usable with problems in some items or records, or passed (possibly with warnings).
  - As the spec says for receivers, problems in the mdoc layer (signatures, digests, validity dates) are warnings, not failures.
- **[Testing wallet](https://smart-health-checkin.org/connectathon/testing-wallet/)**
  - Answers with a choice of patient, statuses, and artifact shapes.
  - Checks each incoming request against [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model) and reports problems.
  - Can send deliberately broken responses so EHRs can test their error handling: a wrong canonical echo, a missing status, an unaccepted media type, a bad signature, and more. Each is labeled with how an EHR that follows the spec reacts: reject the response, set one record aside, treat one item as unknown, or warn. The full list is in its [features page](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md).

Each scenario is a named test case in both tools, so a self-serve run gives a pass or fail, with a link that files it as a result.

## Reference Android wallet

Download: <https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-checkin-wallet-debug.apk>

- **On the phone:** open the link, download the file, and allow installs from your browser when Android asks.
- **With adb:** download the file first, since adb cannot install from a URL:
  ```
  curl -LO https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-checkin-wallet-debug.apk
  adb install -r smart-checkin-wallet-debug.apk
  ```
- **Requirements:** Android 8 or later, and a Chrome version with the Digital Credentials API. Open the app once after installing so it registers with the phone's Credential Manager.
- **Test patient:** the same synthetic patients as the SMART Testing Wallet. Choose Aria Test, or the large record for L2, on the app's home screen.

From `wallet-v0.3.6` on, new builds install over old ones. Earlier builds were signed with a different key: uninstall one of those once (`adb uninstall org.smarthealthit.checkin.wallet`) before installing a newer build.

## What to record

File one result per run through the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml): EHR, wallet, path (web or native), scenario, device and browser, pass or fail, and a note. Attach a screenshot of the EHR display and, where possible, the captured request and response, or the testing tool's log.
