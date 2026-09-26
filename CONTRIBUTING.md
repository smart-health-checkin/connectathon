# How to register for the connectathon

Each participating organization has one file in [`participants/`](participants/), named after the organization, such as `participants/example-health.json`. It lists your components: Verifiers (the side that asks for data; EHR check-in pages, patient portals, kiosks, and clinic apps register as Verifiers), web wallets, and native wallets. The site builds the [directory](https://smart-health-checkin.org/connectathon/directory.html) from these files. Only web wallets also go into the [wallet registry](https://smart-health-checkin.org/connectathon/scenarios.html#wallet-registry) (`wallets.json`), because Verifier pages open them directly; native wallets are reached through the phone's own wallet chooser, so they're listed in the directory only.

## The easy way: the registration form

Fill in the [registration form](https://smart-health-checkin.org/connectathon/register/). It has a field for everything below, checks your entries against the same rules as the pull request check, and then opens GitHub with your file filled in. If you don't have write access to this repo, GitHub offers to fork it and open the pull request for you. To change an existing file, pick your organization at the top of the form; it copies the updated JSON and opens the file's GitHub editor for you to paste into.

## Add or change your file by hand

1. Start from one of the [example files on the registration form](https://smart-health-checkin.org/connectathon/register/#examples): a native wallet with no public build, a web wallet, and a Verifier as a web page and as a phone app. The fields are defined in [`participants/schema.json`](participants/schema.json) and [below](#fields-for-each-component).
2. Edit it in the GitHub web editor or locally, then open a pull request.
3. A check runs on the pull request.
   - If you're listed in the file's `contacts` with your GitHub username, and the file passes the checks, it merges automatically. The site and `wallets.json` update a few minutes later.
   - A file can only be changed by its own contacts. For an existing file, that means the contacts already on `main`. To add a colleague, add their GitHub username to `contacts` first.
   - Anything else waits for a maintainer.

If you'd rather not use GitHub, post your file's contents in [`#kill-the-clipboard`](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT) on the CMS Health Tech Ecosystem Slack and a maintainer will add it.

Everything in your file is public. Only list contact details you're happy to publish. `contacts` needs at least one person, each with a `github` username, `slack` display name, or `email`; list a GitHub username so your pull requests merge on their own.

## Fields for each component

| Role | Required | Notes |
|---|---|---|
| `verifier` | `id`, `name`, `status`, and `url` or `platforms` | Verifier: the side that asks for data. EHR check-in pages, patient portals, kiosks, and clinic apps register as Verifiers. A web page (check-in page, portal, or kiosk) sets `url`, its public page that starts a check-in. A phone app sets the [phone app fields](#phone-app-fields) instead. |
| `web-wallet` | `id`, `name`, `status`, `walletUrl` | `walletUrl` is the page a Verifier opens. It follows the [web wallet hand-off](https://smart-health-checkin.org/client/docs/web-wallet-handoff.html). Optional: `description`, `testPatient`, `iconUrl`, `homepage` (defaults to the organization's), and `target` (`tab` or `popup`). These make up the wallet's [registry](https://smart-health-checkin.org/connectathon/scenarios.html#wallet-registry) entry. |
| `native-wallet` | `id`, `name`, `status`, `platforms`, and `installUrl` unless `access` says otherwise | A phone app, reached through the phone's wallet chooser; not in the registry. Uses the [phone app fields](#phone-app-fields). Optional: `largeResponses` (`true` when it can answer with responses over 512 KB, the [L2 scenario](https://smart-health-checkin.org/connectathon/scenarios.html#larger-data-scenarios); on Android that means the large-payload response API) and `testPatient`. |

Every component can also have `description` (one or two sentences for the directory) and `notes` (anything a tester needs to know).

<a id="phone-app-fields"></a>**Phone app fields**, for a native wallet or a Verifier that is an app:

| Field | Meaning |
|---|---|
| `platforms` | `["android"]`, `["ios"]`, or both. |
| `access` | How testers get it. `install` (the default): anyone can install it from `installUrl`. `invite`: testers ask a contact for an invite or a build, such as TestFlight or a Play test track. `team-device`: there's no build to share, so testers try it with you, on your phone. Say in `notes` how to ask or where to find you. |
| `installUrl` | An APK, a public TestFlight link, or a store page. Required when `access` is `install`; optional otherwise. |
| `requirements` | What a tester's phone needs, such as "Android 10 or later with Chrome 141 or later" or "iPhone with iOS 26 and Safari". |

`id` must be unique across all participants. It uses lowercase letters, digits, and hyphens. Result reports use it, and a web wallet's `id` is also its id in the registry.

<a id="status"></a>`status` is `up` when others can test with it now, `not-yet` before then, and `broken` if it stops working:

- A web page or web wallet is `up` when anyone can open it, without you.
- A phone app is `up` when it works and testers can get it the way `access` says, including by testing with you on your phone.
- Only web wallets that are `up` go into `wallets.json`. Keep the status current, since Verifier pages load the registry live.

## Check your file locally

```
bun install
bun run check
```

## Filing results

File one GitHub issue per test run with the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml). The [results page](https://smart-health-checkin.org/connectathon/results.html) is rebuilt from those issues.
