# Testing guide

Everything a software team needs beyond the [minimum scenarios](./#scenarios-and-tools) on the front page: how to test, the ground rules, more scenarios, the test tools' options, how to record a result, and the event's shared resources. Start with your role's page, [Verifier developers](verifier-developers.html) or [Wallet developers](wallet-developers.html), for what to build and how to register. Section links below go to the spec, [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/).

## How to test

Make your component testable without you in the room, and list it in the [Participant directory](directory.html) by [registering](register/): a Verifier lists its check-in page URL, a web wallet goes into the [wallet registry](#wallet-registry), and a native wallet says how testers get it. Verifier teams (EHRs, portals, and other check-in pages) and wallet teams run the scenarios in pairs, with as many counterparts as they can reach. Test early and alone against the [SMART Testing EHR](testing-ehr/) and the [SMART Testing Wallet](testing-wallet/), so the live event is left for problems that need two people. A failure is as useful as a pass, since it often points to a gap in the spec or an interoperability bug.

Each scenario gives its request, the step for the person using the wallet, what the Verifier should see, what counts as a pass for each side, and how to run it with the test tools. Every response must also pass the spec's own checks, which the SMART Testing EHR runs and links to their requirements.

## Ground rules

- **Open trust.** Wallets accept any Verifier origin and don't require reader authentication, and Verifiers accept responses from any wallet. There are no certificates or trust lists ([§7](https://smart-health-checkin.org/spec/#7-trust-framework)).
- **No patient matching.** Each wallet holds its own synthetic patient. Verifiers show what arrives and don't match it to a chart.
- **Handoff is a plain link.** The patient opens the Verifier's check-in page in a browser. Portal buttons, text messages, and QR codes are product choices outside the spec ([§1.3](https://smart-health-checkin.org/spec/#1-3-handoffs-as-on-ramps)).
- **FHIR R4 and US Core.** Every request asks for FHIR 4.0.1 as `application/fhir+json`; the insurance item also accepts a SMART Health Card ([§5.6](https://smart-health-checkin.org/spec/#5-6-accepted-media-types)).
- **Responses under 512 KB.** Every minimum scenario's response fits in 512 KB. Larger responses have their own [scenarios](#larger-data-scenarios).
- **Your own devices.** Native-wallet testing needs an Android phone with Chrome, or an iPhone with Safari 26, with a wallet installed. For Android there is the [reference Android wallet](#reference-android-wallet); for iOS, use participants' own wallets.

## Larger data scenarios

For teams that have passed the minimum scenarios. These test that a large response arrives intact, from the wallet through the browser to the Verifier. The [ground rules](#ground-rules) apply, except that responses can be any size.

<!-- test cases: advanced larger-data -->

## More scenarios

These exercise parts of the spec that the minimum scenarios leave out: forms and selectors beyond the basics, SMART Health Cards, other ways of reaching the check-in page, and what happens when a patient shares nothing. None is required. Some need a feature that few wallets have yet, such as answering two items with one record ([shared-artifact](#shared-artifact)), which the SMART Testing Wallet can do on request.

<!-- test cases: advanced -->

## Example questionnaires

There is no single intake form for this event. These forms give Verifiers something realistic to send and wallets something realistic to render. Each is hosted as a FHIR Questionnaire whose `url` is its address, so a wallet can also fetch it by reference ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)).

| Form | Kind | Used in |
|---|---|---|
| [PHQ-2 depression screen](Questionnaire/phq-2.json), 2 questions | Standard screening instrument | [fill-form](./#fill-form), [versioned-canonical](#versioned-canonical) |
| [GAD-7 anxiety screen](Questionnaire/gad-7.json), 7 questions | Standard screening instrument | [form-by-reference](#form-by-reference) |
| [Semaglutide 4-week check-in](Questionnaire/semaglutide-4-week-checkin.json), 13 questions | Written by a physician for patients starting this one medication | [physician-form](#physician-form), [prefilled-form](#prefilled-form) |

The semaglutide form asks only what the patient's record can't answer: how the weekly shots are going, missed doses, pen problems, nausea and other side effects, warning symptoms, and readiness to step up the dose. It uses integer, yes/no, single-choice, check-all-that-apply, and free-text items. One question accepts both checked options and the patient's own words. Two items appear only when an earlier answer calls for them. No item is required.

## Testing EHR and Testing Wallet

Beyond running a scenario, both test tools can send and answer things of your choosing.

- **[SMART Testing EHR](testing-ehr/)**
  - "What to send" chooses the request: any scenario's request, one you build from their items, or one you paste. The request is all that goes to the wallet.
  - "Which wallet" sends to any registry wallet, any web wallet by URL, or the phone's own wallet. The EHR opens each wallet at the URL it's given and judges every response the same way.
  - It checks the response against the spec, each check linked to its requirement. The verdict says whether the response was rejected, usable with problems in some items or records, or passed, possibly with warnings. As the spec says for receivers, problems in the mdoc layer (signatures, digests, validity dates) are warnings, not failures.
- **[SMART Testing Wallet](testing-wallet/)**
  - Answers with a choice of patient, statuses, and artifact shapes, and reports any problems with the incoming request against [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model).
  - Can send deliberately broken or very large responses, so Verifiers can test their error handling: a wrong canonical echo, a missing status, an unaccepted media type, a bad signature, a 5 MB response, and more. Each fault is labeled with how a Verifier that follows the spec reacts: reject the response, set one record aside, treat one item as unknown, or warn. The full list is on its [features page](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#testing-panel).
  - To test your own Verifier with these options, open the wallet, set them in its testing panel, choose "Copy wallet URL for these settings", and add that URL as a web wallet on your page. From the Testing EHR, "Testing Wallet options" does the same. These [config URLs](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#config-urls) are the Testing Wallet's own format, not part of SMART Health Check-in.

## Recording results

Record each run through the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml): the Verifier, the wallet, the path (web wallet or native wallet), the scenario, the device and browser, pass or fail, and a note. Attach a screenshot of what the Verifier showed and, where you can, the captured request and response or the Testing EHR's log. After a run, the Testing EHR's “File this result” button fills in the form for you. The [Results](results.html) page collects every run.

Then tell us how it went in a short experience report, from the [developer track](share.html#developers) on the Share your experience page.

## Shared resources

The event's resources are all under `https://smart-health-checkin.org/connectathon/`.

| Resource | Link |
|---|---|
| Who is bringing what | [Participant directory](directory.html); get listed with the [registration form](register/) |
| Test results | [File a result](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml); [all results](results.html) |
| Web wallets for Verifier pages to list | [wallets.json](wallets.json) ([how it works](#wallet-registry)) |
| Every scenario's request | [Test requests](requests/) |
| A Verifier to test wallets with | [SMART Testing EHR](testing-ehr/) |
| A web wallet to test Verifiers with | [SMART Testing Wallet](testing-wallet/) ([what it does](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md)) |
| A native wallet for Android | [Reference Android wallet](#reference-android-wallet) |
| A working check-in page | [Clinic check-in demo](https://smart-health-checkin.org/client/demo/), also [with the event registry](https://smart-health-checkin.org/client/demo/#wallets=https%3A%2F%2Fsmart-health-checkin.org%2Fconnectathon%2Fwallets.json) |
| How web wallets talk to a Verifier page | [Web wallets](https://smart-health-checkin.org/client/docs/web-wallets.html) in the client docs |
| Questions and pairing | `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open the channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)) |

### Wallet registry

The event registry, <https://smart-health-checkin.org/connectathon/wallets.json>, lists every web wallet in the [participant directory](directory.html#web-wallets) whose status is up. Verifier pages read it to list the wallets a patient can choose. It uses the format the client library reads ([Registry format](https://smart-health-checkin.org/client/docs/registry.html)):

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

You don't edit this file. The [registration form](register/) adds your web wallet to your organization's participant file, and the registry is built from those files ([fields](https://github.com/smart-health-checkin/connectathon/blob/main/CONTRIBUTING.md#fields-for-each-component)). Native wallets aren't in it, because the phone's own wallet chooser reaches them; they're listed in the [Participant directory](directory.html#native-wallets) only.

The list changes during testing, so a Verifier should load it each time its check-in page opens, or sync it automatically, rather than build it in.

### Reference Android wallet

A native wallet for Android, holding the same synthetic patients as the SMART Testing Wallet. [Download the latest APK](https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-health-checkin-wallet.apk).

- **On the phone:** open the link, download the file, and allow installs from your browser when Android asks.
- **With adb:** download the file first, since adb can't install from a URL:
  ```sh
  curl -LO https://github.com/smart-health-checkin/android-wallet/releases/latest/download/smart-health-checkin-wallet.apk
  adb install -r smart-health-checkin-wallet.apk
  ```
- **Requirements:** Android 8 or later, and a Chrome version with the Digital Credentials API. Open the app once after installing, so it registers with the phone's Credential Manager.
- **Test patient:** choose Aria Test on the app's home screen, or the large record for [large-response](#large-response).
