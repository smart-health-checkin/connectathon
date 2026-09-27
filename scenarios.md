# Test scenarios

The scenarios developers run at the connectathon: EHRs, portals, and other Verifiers on one side, wallets on the other. Start with your role's page, [Verifier developers](verifier-developers.html) or [Wallet developers](wallet-developers.html), for what to build and how to register. This page is the shared reference for testing.

The spec is [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/); section links below go to it.

## How to test

- **Make your component self-serve.** Put up something anyone can test against without you in the room, and list it in the [Participant directory](directory.html) by [registering](register/):
  - Verifier (EHR, portal, or kiosk): a public check-in page URL. A Verifier that is a phone app lists its platforms and how testers get it.
  - Web wallet: an entry in the [registry](#wallet-registry).
  - Native wallet: its platforms, how testers get it (an install link, an invite on request, or testing with you on your phone), and the name of its test patient. Native wallets aren't in the registry: the phone's own wallet chooser reaches them.
- **Test early.** Self-serve testing in the week before the event leaves the live session for problems that need two people. The [SMART Testing EHR and SMART Testing Wallet](#testing-ehr-and-testing-wallet) are always available as counterparts.
- **Try to test with every counterpart** over the course of the event.
- **Record failures as well as passes.** A failure often points to a spec gap or an interop bug. See [recording results](#recording-results).

## Technical ground rules

- **Open trust.** Wallets accept any EHR origin and do not require reader authentication. EHRs accept responses from any wallet. There are no certificates or trust lists ([§7](https://smart-health-checkin.org/spec/#7-trust-framework)).
- **No patient matching.** Each wallet holds its own synthetic patient. EHRs display what arrives and do not match it to a chart.
- **Handoff is a plain link.** The patient opens the EHR's check-in page in a browser. Portal buttons, SMS, and QR codes are product choices outside the spec ([§1.3](https://smart-health-checkin.org/spec/#1-3-handoffs-as-on-ramps)).
- **Bring your own devices.** Native-wallet testing needs an Android phone with Chrome, or an iPhone with Safari 26, with a wallet installed. There is a [reference Android wallet](#reference-android-wallet). There is no reference iOS wallet, so iOS testing uses participants' own wallets.
- **Small responses first.** To keep the basics simple, every minimum scenario expects responses under 512 KB. Large responses have their own [scenarios](#larger-data-scenarios).
- **FHIR R4 and US Core.** Requests use `fhirVersions: ["4.0.1"]` and `accept: ["application/fhir+json"]`. The insurance item also accepts a SMART Health Card ([§5.6](https://smart-health-checkin.org/spec/#5-6-accepted-media-types)).

## Shared resources

Everything the event provides, in one place. The event's own resources are all under `https://smart-health-checkin.org/connectathon/`.

| Resource | Link |
|---|---|
| Participant directory: your check-in URL, your registry entry, or how testers get your app, and your test patient | [Participant directory](directory.html). Get listed with the [registration form](register/), which opens a pull request for you. |
| Test results: one GitHub issue per run, filed through a form | [File a result](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml); [all results](results.html) |
| Wallet registry | [wallets.json](wallets.json) ([details](#wallet-registry)) |
| How web wallets talk to the EHR page | [Web wallets](https://smart-health-checkin.org/client/docs/web-wallets.html) in the client docs |
| Baseline and scenario requests | [Test requests](requests/) |
| Example questionnaires | [Test questionnaires](Questionnaire/) |
| Clinic check-in | [Clinic check-in demo](https://smart-health-checkin.org/client/demo/); [with the event registry loaded](https://smart-health-checkin.org/client/demo/#wallets=https%3A%2F%2Fsmart-health-checkin.org%2Fconnectathon%2Fwallets.json) |
| Sample responses: what a wallet sends for Baselines 1 to 3, decrypted | [Baseline 1](responses/baseline-1.sample.json), [Baseline 2](responses/baseline-2.sample.json), [Baseline 3](responses/baseline-3.sample.json) |
| Reference Android wallet | [Download the APK](https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-health-checkin-wallet.apk); [install steps](#reference-android-wallet) |
| SMART Testing EHR | [SMART Testing EHR](testing-ehr/) ([details](#testing-ehr-and-testing-wallet)) |
| SMART Testing Wallet: the reference web wallet, also usable for fault testing | [SMART Testing Wallet](testing-wallet/), also in the registry; [what it does](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md); [config URLs](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#config-urls) for fault and size tests |
| Chat for questions and pairing | `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)) |

### Wallet registry

The event registry lists every participating web wallet whose status is up in the [participant directory](directory.html#web-wallets), at <https://smart-health-checkin.org/connectathon/wallets.json>. It uses the format the client library reads ([Registry format](https://smart-health-checkin.org/client/docs/registry.html)):

```json
{
  "source": "KTC SMART Health Check-in connectathon registry",
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

You don't edit this file directly. Add your web wallet on the [registration form](https://smart-health-checkin.org/connectathon/register/), which fills in every registry field and opens a pull request with your organization's participant file. The registry is regenerated from those files ([details](https://github.com/smart-health-checkin/connectathon/blob/main/CONTRIBUTING.md#fields-for-each-component)). Native wallets aren't in it: the phone's own wallet chooser reaches them, so they're listed in the [Participant directory](directory.html#native-wallets) only.

The list will change during testing. EHRs should load it from the registry URL each time the check-in page opens, or sync it automatically, so changes need no redeploy.

### Example questionnaires

There is no single intake form for this event. These examples give EHRs something realistic to send and wallets something realistic to render. Each is hosted as a FHIR Questionnaire whose `url` is its hosted address, so a wallet can also fetch it by reference ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)).

| Form | Kind | Link |
|---|---|---|
| PHQ-2 depression screen, 2 questions | Standard screening instrument, used in [Baseline 3](#baseline-3) | <https://smart-health-checkin.org/connectathon/Questionnaire/phq-2.json> |
| GAD-7 anxiety screen, 7 questions | Standard screening instrument | <https://smart-health-checkin.org/connectathon/Questionnaire/gad-7.json> |
| Semaglutide 4-week check-in, 13 questions | Written by a physician for patients starting this one medication | <https://smart-health-checkin.org/connectathon/Questionnaire/semaglutide-4-week-checkin.json> |

The semaglutide form asks only what the patient's record can't answer: how the weekly shots are going, missed doses, pen problems, nausea and other side effects, warning symptoms, and readiness to step up the dose. It uses integer, yes/no, single-choice, check-all-that-apply, and free-text items. One question accepts both checked options and the patient's own words. Two items appear only when an earlier answer calls for them. No item is required.

## Baseline requests

EHRs should be able to send Baselines 1 to 3, and wallets should be able to answer them. To keep these basics simple, their responses are expected to stay under 512 KB. [Baseline 4](#baseline-4) is for the [larger-data scenarios](#larger-data-scenarios). Each is published at `https://smart-health-checkin.org/connectathon/requests/baseline-N.json`. `…` stands for `http://hl7.org/fhir/us/core/StructureDefinition`.

<a id="baseline-1"></a>**Baseline 1: demographics and PAMI** (problems, allergies, medications, immunizations)

| Item id | Title | Selector ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)) |
|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` |
| `problems` | Problems and health concerns | `profiles: ["…/us-core-condition-problems-health-concerns"]` |
| `allergies` | Allergies | `profiles: ["…/us-core-allergyintolerance"]` |
| `medications` | Medications | `profiles: ["…/us-core-medicationrequest"]` |
| `immunizations` | Immunizations | `profiles: ["…/us-core-immunization"]` |

<a id="baseline-2"></a>**Baseline 2: demographics and insurance**

| Item id | Title | Selector | Accept |
|---|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` | `application/fhir+json` |
| `coverage` | Insurance | `profiles: ["http://hl7.org/fhir/us/insurance-card/StructureDefinition/C4DIC-Coverage", "…/us-core-coverage"]` | `application/fhir+json`, `application/smart-health-card` |

The two coverage profiles are alternatives: a wallet may hold the CARIN digital insurance card, US Core Coverage, or both ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir)).

<a id="baseline-3"></a>**Baseline 3: demographics and a pre-visit questionnaire**

| Item id | Title | Selector |
|---|---|---|
| `patient` | Demographics | `profiles: ["…/us-core-patient"]` |
| `phq2` | Two questions about your mood | `form.fhir` with the PHQ-2 Questionnaire inline and its `questionnaireCanonical` ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)) |

<a id="baseline-4"></a>**Baseline 4: anything in USCDI**

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

Use [Baselines 1 to 3](#baseline-requests), with responses under 512 KB. Run them for every EHR and wallet pairing you can reach.

Each test case below has a request, a step for the person using the wallet (if the case needs one), the checks a Verifier makes on the response, and what to look for by eye. The [SMART Testing EHR](testing-ehr/) runs the checks for you when you choose the case.

<!-- test cases: M -->

## Larger data scenarios

[Baseline 4](#baseline-4), which tests that large responses work end to end. It's kept apart from the [minimum scenarios](#minimum-scenarios) so those stay simple.

<!-- test cases: L -->

## Optional and stretch scenarios

<!-- test cases: O -->

## Testing EHR and Testing Wallet

Two test tools let each participant run the scenarios above against a known-good counterpart without waiting for a partner.

- **[SMART Testing EHR](testing-ehr/)**
  - "What to send" chooses the request: a baseline or scenario request, one you build from items, or one you paste. The request is all that goes to the wallet.
  - "Test case" is optional. It shows the case's step for the person using the wallet, and the checks it will make on the response, and reports each as met or not next to the spec checks. Choosing a case selects its request.
  - "Which wallet" sends to any registry wallet, any web wallet by URL, or the phone's own wallet. It opens each wallet at the URL it's given and judges every response the same way.
  - With the SMART Testing Wallet chosen, "Testing Wallet options" sets faults, forced statuses, and a response size, and does the test case's step, by opening that wallet at one of its [config URLs](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#config-urls).
  - Checks the response against the spec, each check linked to its requirement. The verdict says whether the response was rejected, usable with problems in some items or records, or passed (possibly with warnings).
  - As the spec says for receivers, problems in the mdoc layer (signatures, digests, validity dates) are warnings, not failures.
- **[SMART Testing Wallet](testing-wallet/)**
  - Answers with a choice of patient, statuses, and artifact shapes.
  - Checks each incoming request against [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model) and reports problems.
  - Can send deliberately broken or very large responses so Verifiers can test their error handling: a wrong canonical echo, a missing status, an unaccepted media type, a bad signature, a 5 MB response, and more. Each fault is labeled with how a Verifier that follows the spec reacts: reject the response, set one record aside, treat one item as unknown, or warn. The full list is in its [features page](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#testing-panel).
  - To test your own Verifier with these options, open the wallet, set them in its testing panel, choose "Copy wallet URL for these settings", and add that URL as a web wallet on your page. Then run check-ins from your page as usual. For example, bad signature is `https://smart-health-checkin.org/connectathon/testing-wallet/eyJmYXVsdHMiOlsiYmFkLXNpZ25hdHVyZSJdfQ/` and a 5 MB response is `https://smart-health-checkin.org/connectathon/testing-wallet/eyJzaXplIjoiNW0ifQ/`. These [config URLs](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#config-urls) are the Testing Wallet's own format, not part of SMART Health Check-in.

Each scenario is a test case in the Testing EHR, so a self-serve run gives a pass or fail, with a link that files it as a result.

## Reference Android wallet

Download: [the latest APK](https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-health-checkin-wallet.apk)

- **On the phone:** open the link, download the file, and allow installs from your browser when Android asks.
- **With adb:** download the file first, since adb cannot install from a URL:
  ```
  curl -LO https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-health-checkin-wallet.apk
  adb install -r smart-health-checkin-wallet.apk
  ```
- **Requirements:** Android 8 or later, and a Chrome version with the Digital Credentials API. Open the app once after installing so it registers with the phone's Credential Manager.
- **Test patient:** the same synthetic patients as the SMART Testing Wallet. Choose Aria Test, or the large record for [L2](#larger-data-scenarios), on the app's home screen.

## Recording results

Record each run of a formal scenario through the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml): EHR, wallet, path (web or native), scenario, device and browser, pass or fail, and a note. Attach a screenshot of the EHR display and, where possible, the captured request and response, or the testing tool's log. The [Results](results.html) page collects them.

Then tell us how the whole thing went in a short experience report. The [developer track](share.html#developers) on the Share your experience page has a debrief prompt for any AI assistant, and the experience form.
