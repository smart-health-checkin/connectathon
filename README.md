# SMART Health Check-in connectathon

Resources for the KTC pre-visit check-in connectathon, served at <https://smart-health-checkin.org/connectathon/>.

| Path | What it is |
|---|---|
| `scenarios.md` | The test scenarios. Rendered as the site's front page. |
| `web-wallet-handoff.md` | How an EHR and a web wallet exchange requests and responses. |
| `participants/` | One file per organization. [How to register](CONTRIBUTING.md). |
| `requests/` | Baseline and optional-scenario requests. |
| `Questionnaire/` | Example FHIR Questionnaires, served at their canonical URLs. |
| `catalog.json` | Test cases used by the testing EHR and testing wallet. |
| `testing-ehr/`, `testing-wallet/` | The test tools. |

`wallets.json`, the directory, and the results page are generated at build time.

```
bun install
bun run check   # validate everything
bun run build   # validate and build the site into _site/
```

Pushes to `main` deploy through GitHub Pages.
