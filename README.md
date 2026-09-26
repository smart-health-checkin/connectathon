# SMART Health Check-in connectathon

Resources for the KTC pre-visit check-in connectathon, served at <https://smart-health-checkin.org/connectathon/>.

| Path | What it is |
|---|---|
| `index.md` | The front page: pick your path, how the event works, the schedule. |
| `patients.md`, `clinic-staff.md`, `verifier-developers.md`, `wallet-developers.md`, `observers.md` | One page per participant type: background, getting started, joining, sharing what you found. |
| `scenarios.md` | The developer test reference: ground rules, shared resources, baseline requests, scenarios, test tools. |
| `prompts/` | Prompts people paste into any AI assistant: a patient guide and an implementer debrief. Offered on the generated [share page](https://smart-health-checkin.org/connectathon/share.html). |
| `participants/` | One file per organization. [How to register](CONTRIBUTING.md). |
| `requests/` | Baseline and optional-scenario requests. |
| `Questionnaire/` | Example FHIR Questionnaires, served at their canonical URLs. |
| `catalog.json` | Test cases used by the testing EHR and testing wallet. |
| `testing-ehr/`, `testing-wallet/` | The test tools. |
| `scripts/links.ts` | The experience-form URL and the prompt list, used by the share page and the prompts. |
| `tools/experience-form/` | Apps Script that builds the experience-report Google Form. |

`wallets.json`, the directory, the results page, and the share page are generated at build time.

Experience reports: people paste a prompt from `prompts/` into any AI assistant, which guides them and helps write a report, then they send it through the Google Form (reports are public). The share page offers the prompts and the form; the form URL lives only in `scripts/links.ts`; `tools/experience-form/form.gs` rebuilds the form in place. To change a prompt, edit its file in `prompts/` and push. Structured pass/fail result issues remain optional for formal scenarios.

```
bun install
bun run check   # validate everything
bun run build   # validate and build the site into _site/
```

Pushes to `main` deploy through GitHub Pages.

## End-to-end checks

- Web: `bun scripts/self-test.ts` drives the live testing EHR against the live testing wallet for every web-path scenario and every fault. It runs nightly in CI.
- Android: `bun scripts/android-e2e.ts [M1 M3 …]` drives the live testing EHR in an Android device's Chrome, through the Digital Credentials API, to the installed reference Android wallet. It runs nightly in CI on an emulator (`android-e2e.yml`).
  - It picks the wallet's patient for each case, answers every choice question in a form, and checks that the answers arrived.
  - L2 is skipped on Chrome before 150, which can't receive responses over about 500 KB from an Android wallet. The emulator image ships Chrome 145, so L2 on Android is a manual check on a real phone.

Setting up an emulator for the Android run:

```
sdkmanager "system-images;android-37.0;google_apis_playstore;x86_64" emulator
avdmanager create avd -n ktc_api37 -k "system-images;android-37.0;google_apis_playstore;x86_64" -d pixel_8
emulator -avd ktc_api37 -no-window -no-audio -gpu swiftshader_indirect &
bun scripts/android-e2e.ts --release          # installs the latest release APK first
bun scripts/android-e2e.ts --apk path/to.apk  # or a local build
```

Older images don't work: the Digital Credentials API needs a current Chrome and Google Play services.
