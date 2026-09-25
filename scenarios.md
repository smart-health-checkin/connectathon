# SMART Health Check-in connectathon: test scenarios

<p class="draft"><b>Draft.</b> Resources are being set up now. Links marked <code>{{TBD: …}}</code> and components marked "not yet" in the <a href="directory.html">directory</a> are not live yet.</p>

KTC pre-visit check-in connectathon, {{TBD: event date and time}}, about 3 hours, on Zoom: {{TBD: Zoom link}}.

Spec: [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/). Section links below go to that page.
Event resources: <https://smart-health-checkin.org/connectathon/>, published from the [`smart-health-checkin/connectathon`](https://github.com/smart-health-checkin/connectathon) repository. The URLs below are where each resource will live. Items still marked `{{TBD: …}}` will be filled in as they are set up.

## Timeline

- **{{TBD: date, 3 weeks before}}:** reference implementations, test tools, the wallet registry, example questionnaires, and baseline requests are live.
- **{{TBD: date, 1 week before}}:** aim to have your component up for self-serve testing and to have tried a first connection.
- **The event:** ideally spent on the harder problems and live debugging. We expect some people will still be finishing basic setup, and that's fine.

## Roles

### EHR

The practice system. Its check-in page builds a request, offers the patient a choice of wallet, and processes the response in the same page.

1. Build a SMART request: JSON with `type`, `version`, a unique `id`, and `items[]`. Each item has an `id`, a `title`, a `content` selector, and `accept[]` ([§5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model)).
2. Wrap it for the Digital Credentials API. Put the request JSON string in `ItemsRequest.requestInfo["org.smarthealthit.checkin.request"]`, with `docType` `org.smarthealthit.checkin.1`, namespace `org.smarthealthit.checkin`, and element `smart_health_checkin_response`. Tag-24 wrap it inside a version `1.0` `DeviceRequest`. Generate a fresh P-256 HPKE key and a CBOR `encryptionInfo` holding a nonce and the public key ([§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants), [§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction), [A.3](https://smart-health-checkin.org/spec/#a-3-devicerequest-docrequest-and-tag-24-itemsrequest)).
3. Send `{protocol: "org-iso-mdoc", data: {deviceRequest, encryptionInfo}}` ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers)) to the wallet the patient picked. For a native wallet, call `navigator.credentials.get`. For a web wallet, use the [web wallet hand-off](#web-wallet) below.
4. Open the response. Base64url-decode `data.response`, open the HPKE envelope with the private key and a `SessionTranscript` built from the exact `encryptionInfo` string and the page's origin, then check the `DeviceResponse`, the issuer and device signatures, and the digest over the response item ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript), [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing), [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist)).
5. Check the SMART response against the request: `requestId` matches, there is exactly one status per item, and every artifact's media type was accepted by the items it claims to fulfill ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation)). Then show staff each item's status and data.

The [client library](https://smart-health-checkin.org/client/) does steps 2 to 5 for JavaScript pages. Install it from GitHub: `npm install github:smart-health-checkin/client`.

### Native wallet

A health app installed on the phone. The browser passes it the EHR's request through the Digital Credentials API, and the operating system shows it as a choice to the patient. On Android, the app registers with Credential Manager, and a matcher decides whether it can answer a request.

1. Validate the request: the `DeviceRequest`, the `ItemsRequest`, the request carrier, and the SMART request inside it ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction)).
2. Show the patient each item and let them choose, item by item. `required: true` is advice, not consent ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction)).
3. Build a SMART response with one status per item and the artifacts the patient chose ([§6.1](https://smart-health-checkin.org/spec/#6-1-normative-typescript-model), [§6.2](https://smart-health-checkin.org/spec/#6-2-artifact-and-status-semantics)).
4. Put the response JSON in an issuer-signed item, sign the MSO and device authentication, and HPKE-encrypt the `DeviceResponse` to the EHR's key, using the origin the platform supplies ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript), [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction), [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)).

### Web wallet

A health app that runs as a website. It does the same work as a native wallet, but the EHR reaches it by opening a tab and exchanging `postMessage` messages instead of calling the Digital Credentials API. The request and response inside the messages are exactly the ones a native wallet gets and returns.

1. The EHR opens the wallet's `walletUrl` from the [registry](#wallet-registry) in a new tab, during the patient's click.
2. The wallet signals it has loaded:
   ```js
   window.opener.postMessage({ type: "digital-credentials/web-wallet/ready" }, "*");
   ```
3. The EHR sends the request, targeted at the wallet's origin:
   ```js
   { type: "digital-credentials/web-wallet/request",
     requestId: "<opaque>",
     credentialRequestOptions: { digital: { requests: [
       { protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } } ] } } }
   ```
4. The wallet takes the EHR's origin from `event.origin` on that message, shows it to the patient, and uses it in the `SessionTranscript` ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript)). It never uses an origin written inside the message. It then does native-wallet steps 1 to 4.
5. The wallet replies to that origin:
   ```js
   { type: "digital-credentials/web-wallet/response",
     requestId: "<same>",
     outcome: "approved",
     credential: { protocol: "org-iso-mdoc", data: { response } } }
   ```
   `outcome` is `"declined"`, or `"error"` with a `message`, when the patient cancels or something fails.

Full hand-off details: <https://smart-health-checkin.org/connectathon/web-wallet-handoff.html>.

## How we'll work together

- **Make your component self-serve.** Put up something anyone can test against without you in the room, and list it in the [participant directory](#shared-resources). An EHR lists a public check-in page URL. A web wallet adds its entry to the [registry](#wallet-registry). A native wallet lists an install link and the name of its test patient.
- **Test early.** Self-serve testing in the week before the event leaves the live session for problems that need two people.
- **Main room plus your own breakout rooms.** The event runs in one Zoom meeting. Kickoff, check-ins, and the report-out happen in the main room. When a pair needs to debug together, one of them starts a Slack huddle in a direct message with the other, which has video and screen sharing. For a group, or if someone isn't on the Slack, open a room at `https://meet.jit.si/ktc-checkin-<ehr>-<wallet>` and post the link in `#kill-the-clipboard`.
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
| Participant directory: your check-in URL, install link, or registry entry, and your test patient | <https://smart-health-checkin.org/connectathon/directory.html>. Register by pull request, see [how to register](https://github.com/smart-health-checkin/connectathon/blob/main/CONTRIBUTING.md). |
| Test results: one GitHub issue per run, filed through a form | [file a result](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml); all results at <https://smart-health-checkin.org/connectathon/results.html> |
| Wallet registry | <https://smart-health-checkin.org/connectathon/wallets.json> |
| Web wallet hand-off | <https://smart-health-checkin.org/connectathon/web-wallet-handoff.html> |
| Baseline and scenario requests | <https://smart-health-checkin.org/connectathon/requests/> |
| Example questionnaires | <https://smart-health-checkin.org/connectathon/Questionnaire/> |
| Reference EHR check-in page | <https://smart-health-checkin.org/client/demo/>. Load the event registry with [this link](https://smart-health-checkin.org/client/demo/#wallets=https%3A%2F%2Fsmart-health-checkin.org%2Fconnectathon%2Fwallets.json). |
| Sample responses: what a wallet sends for Baselines 1 to 3, decrypted | <https://smart-health-checkin.org/connectathon/responses/> |
| Reference Android wallet | [download](https://github.com/smart-health-checkin/spec/releases/latest/download/smart-checkin-wallet-debug.apk), see [below](#reference-android-wallet) |
| Testing EHR | <https://smart-health-checkin.org/connectathon/testing-ehr/> |
| SMART Testing Wallet: the reference web wallet, also usable for fault testing | <https://smart-health-checkin.org/connectathon/testing-wallet/>, also in the registry. [What it does](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md). |
| Chat for questions and pairing | `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)) |

### Wallet registry

The event registry lists every participating web wallet, at <https://smart-health-checkin.org/connectathon/wallets.json>. It uses the format the client library reads ([wallets guide](https://smart-health-checkin.org/client/docs/wallets.html)):

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

You don't edit this file directly. Add your web wallet's entry to your organization's participant file by pull request ([how to register](https://github.com/smart-health-checkin/connectathon/blob/main/CONTRIBUTING.md)), and the registry is regenerated from those files.

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
| L2 | Anything in USCDI, large patient: a full history with notes, well over 512 KB | The response arrives intact. Record the browser, phone, and wallet version, since older Android wallet APIs fail near 520 KB. |

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
| O13 | Reader authentication | EHR signs the request with `readerAuth`, and the wallet shows the verified requester ([§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction), [A.4](https://smart-health-checkin.org/spec/#a-4-optional-per-docrequest-readerauth)) | Wallet distinguishes absent, malformed, invalid, untrusted, and trusted signatures. |

## Testing EHR and testing wallet

Two test tools let each participant run the scenarios above against a known-good counterpart without waiting for a partner.

- **[Testing EHR](https://smart-health-checkin.org/connectathon/testing-ehr/)** sends any baseline or scenario request, alone or combined, to any wallet in the registry or to the phone's own wallet. It checks the response against the spec and reports each check as pass or fail. When a response is malformed, it says what is wrong.
- **[Testing wallet](https://smart-health-checkin.org/connectathon/testing-wallet/)** answers with chosen data, statuses, and artifact shapes. It can also send deliberately broken responses, such as a wrong canonical echo, a missing status, an unaccepted media type, or an oversized payload, so EHRs can test their error handling. It checks each incoming request against [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model) and reports problems.

Each scenario is a named test case in both tools, so a self-serve run gives a pass or fail, with a link that files it as a result.

## Reference Android wallet

Download: <https://github.com/smart-health-checkin/spec/releases/latest/download/smart-checkin-wallet-debug.apk>

- **On the phone:** open the link, download the file, and allow installs from your browser when Android asks.
- **With adb:** download the file first, since adb cannot install from a URL:
  ```
  curl -LO https://github.com/smart-health-checkin/spec/releases/latest/download/smart-checkin-wallet-debug.apk
  adb install -r smart-checkin-wallet-debug.apk
  ```
- **Requirements:** Android 8 or later, and a Chrome version with the Digital Credentials API. Open the app once after installing so it registers with the phone's Credential Manager.
- **Test patient:** the same synthetic patients as the SMART Testing Wallet. Choose Aria Test, or the large record for L2, on the app's home screen.

New builds install over old ones without uninstalling.

## What to record

File one result per run through the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml): EHR, wallet, path (web or native), scenario, device and browser, pass or fail, and a note. Attach a screenshot of the EHR display and, where possible, the captured request and response, or the testing tool's log.
