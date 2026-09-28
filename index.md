# SMART Health Check-in connectathon

An online event where patients, clinic staff, and software teams try a new way of checking in for a visit and tell us how it feels.

## How the event works

<p class="smart-callout warn"><b>Draft.</b> The event date isn't set yet, so dates below say "To be announced". Everything else linked here is live. Components marked "not yet" in the <a href="directory.html">Participant directory</a> aren't ready for testing.</p>

- **When and where.** KTC pre-visit check-in connectathon, {{TBD: event date and time}}, about 3 hours, on Zoom: {{TBD: Zoom link}}.
- **What it's for.** Experience with a new way of checking in, not a formal conformance test. Software teams connect clinic systems to patients' health apps, and patients, clinic staff, and community members try the result. It uses the [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/) draft specification.
- **One Zoom meeting.** Everyone joins the main room for the opening, the hourly check-ins, and the closing report-out, where participants share what they found.
- **One chat.** Questions, pairing, and links go in `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack ([open channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT)).
- **Breakout rooms you start yourself.** Two people debugging together: start a Slack huddle in a direct message; it has video and screen sharing. A group, or someone not on the Slack: open `https://meet.jit.si/ktc-checkin-<ehr>-<wallet>` and post the link in the channel.
- **Registration is for software.** Teams bringing an EHR, portal, or wallet [register it](register/) so others can test against it (see the register step for [Verifier developers](verifier-developers.html#register) or [Wallet developers](wallet-developers.html#register)). Everyone else just joins.
- **Made-up data only.** Every patient, record, and clinic in the demos and test tools is synthetic. Never use real health information, even your own.

## Schedule

- **Three weeks before** ({{TBD: date}}): reference implementations, the [SMART Testing EHR](testing-ehr/) and [SMART Testing Wallet](testing-wallet/), the [wallet registry](#wallet-registry), and the [scenarios](#minimum-scenarios) with their [requests](requests/) are live.
- **One week before** ({{TBD: date}}): software teams aim to have their component up for [self-serve testing](#how-to-test) and to have tried a first connection.
- **The event:** ideally spent on the harder problems and live debugging. Some people will still be finishing basic setup, and that's fine.

## How to test

Software teams bring a Verifier (a clinic's check-in page, portal, kiosk, or app, which asks for data) or a wallet (the patient's health app, which answers). Make your component testable without you in the room, and list it in the [Participant directory](directory.html) by [registering](register/): a Verifier lists its check-in page URL, a web wallet goes into the [wallet registry](#wallet-registry), and a native wallet says how testers get it. Verifier and wallet teams run the scenarios in pairs, with as many counterparts as they can reach. Test early and alone against the [SMART Testing EHR](testing-ehr/) and the [SMART Testing Wallet](testing-wallet/), so the live event is left for problems that need two people. A failure is as useful as a pass, since it often points to a gap in the spec or an interoperability bug.

Each scenario gives its request, the step for the person using the wallet, what the Verifier should see, what counts as a pass for each side, and how to run it with the test tools. Every response must also pass the spec's own checks, which the SMART Testing EHR runs and links to their requirements. Section links such as §5.6 go to the spec, [SMART Health Check-in 1.0](https://smart-health-checkin.org/spec/).

## Ground rules

- **Open trust.** Wallets accept any Verifier origin and don't require reader authentication, and Verifiers accept responses from any wallet. There are no certificates or trust lists ([§7](https://smart-health-checkin.org/spec/#7-trust-framework)).
- **Patients don't need to match.** Each wallet holds its own synthetic patient, so what arrives won't match a Verifier's test chart. A Verifier that matches patients should still let these scenarios run to the end and show what arrived.
- **Handoff is a plain link.** The patient opens the Verifier's check-in page in a browser. Portal buttons, text messages, and QR codes are product choices outside the spec ([§1.3](https://smart-health-checkin.org/spec/#1-3-handoffs-as-on-ramps)).
- **FHIR R4 and US Core.** Every request asks for FHIR 4.0.1 as `application/fhir+json`; the insurance item also accepts a SMART Health Card ([§5.6](https://smart-health-checkin.org/spec/#5-6-accepted-media-types)).
- **Responses under 512 KB.** Every minimum scenario's response fits in 512 KB. Larger responses have their own [scenarios](advanced.html#larger-data-scenarios).
- **Your own devices.** Native-wallet testing needs an Android phone with Chrome, or an iPhone with Safari 26, with a wallet installed. For Android there is the [reference Android wallet](#reference-android-wallet); for iOS, use participants' own wallets.

## Minimum scenarios

Every Verifier and every wallet should pass these three scenarios. Record each run as a [result](#recording-results). Teams that pass them can go on to the [advanced scenarios](advanced.html).

<!-- test cases: minimum -->

## Recording results

Record each run through the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml): the Verifier, the wallet, the path (web wallet or native wallet), the scenario, the device and browser, pass or fail, and a note. Attach a screenshot of what the Verifier showed and, where you can, the captured request and response or the Testing EHR's log. After a run, the Testing EHR's “File this result” button fills in the form for you. The [Results](results.html) page collects every run.

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
- **Test patient:** choose Aria Test on the app's home screen, or the large record for [large-response](advanced.html#large-response).

## Pick your path

<div class="paths">
<a class="path" href="patients.html"><b>Patients and community</b><span>Try the demos on any phone or computer, and tell us how it went.</span><em>Start here →</em></a>
<a class="path" href="clinic-staff.html"><b>Clinic staff</b><span>See check-in from the practice side: what arrives, and how it fits the front desk.</span><em>Start here →</em></a>
<a class="path" href="verifier-developers.html"><b>Verifier developers</b><span>EHRs, portals, and other Verifiers: build the check-in page that asks for data.</span><em>Start here →</em></a>
<a class="path" href="wallet-developers.html"><b>Wallet developers</b><span>Build the health app that answers, on a phone or on the web.</span><em>Start here →</em></a>
<a class="path" href="observers.html"><b>Observers</b><span>Follow along, and read what people found.</span><em>Start here →</em></a>
</div>

## Sharing what you found

Everyone is invited to write a short experience report: what you tried, what worked, what was hard, and what you'd change. The [Share your experience](share.html) page has a track for each kind of participant, [patients](share.html#patients), [clinic staff](share.html#clinic-staff), [developers](share.html#developers), and [observers](share.html#observers), with prompts that turn any AI assistant into a guide and the form to send your report. Reports are public, credited with the name and organization you give, or anonymous.
