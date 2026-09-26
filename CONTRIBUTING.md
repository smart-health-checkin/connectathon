# How to register for the connectathon

Each participating organization has one file in [`participants/`](participants/), named after the organization, such as `participants/example-health.json`. It lists your components: EHR check-in pages, web wallets, and native wallets. The site builds the [directory](https://smart-health-checkin.org/connectathon/directory.html) from these files, and generates the [wallet registry](https://smart-health-checkin.org/connectathon/wallets.json) from the web wallets in them.

## The easy way: the registration form

Fill in the [registration form](https://smart-health-checkin.org/connectathon/register/). It has a field for everything below, checks your entries against the same rules as the pull request check, and then opens GitHub with your file filled in. If you don't have write access to this repo, GitHub offers to fork it and open the pull request for you. To change an existing file, pick your organization at the top of the form; it copies the updated JSON and opens the file's GitHub editor for you to paste into.

## Add or change your file by hand

1. Copy [`participants/smart-health-it.json`](participants/smart-health-it.json) as a starting point. The fields are defined in [`participants/schema.json`](participants/schema.json).
2. Edit it in the GitHub web editor or locally, then open a pull request.
3. A check runs on the pull request.
   - If you're listed in the file's `contacts` with your GitHub username, and the file passes the checks, it merges automatically. The site and `wallets.json` update a few minutes later.
   - A file can only be changed by its own contacts. For an existing file, that means the contacts already on `main`. To add a colleague, add their GitHub username to `contacts` first.
   - Anything else waits for a maintainer.

If you'd rather not use GitHub, post your file's contents in [`#kill-the-clipboard`](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT) on the CMS Health Tech Ecosystem Slack and a maintainer will add it.

Everything in your file is public. Only list contact details you're happy to publish.

## Fields for each component

| Role | Required | Notes |
|---|---|---|
| `ehr` | `id`, `name`, `status`, `url` | `url` is your public check-in page. |
| `web-wallet` | `id`, `name`, `status`, `walletUrl` | `walletUrl` is the page an EHR opens. It follows the [web wallet hand-off](https://smart-health-checkin.org/client/docs/web-wallet-handoff.html). Optional: `description`, `testPatient`, `iconUrl`, `homepage` (defaults to the organization's), and `target` (`tab` or `popup`). These make up the wallet's [registry](https://smart-health-checkin.org/connectathon/wallets.json) entry. |
| `native-wallet` | `id`, `name`, `status`, `installUrl`, `platforms` | `installUrl` is where testers install it: an APK link, a TestFlight invite, or a store page. |

`id` must be unique across all participants. It uses lowercase letters, digits, and hyphens. A web wallet's `id` is also its id in the registry.

Set `status` to `up` when others can test against it, `not-yet` before then, and `broken` if it stops working. Keep it current, since EHRs load the registry live.

## Check your file locally

```
bun install
bun run check
```

## Filing results

File one GitHub issue per test run with the [result form](https://github.com/smart-health-checkin/connectathon/issues/new?template=test-result.yml). The [results page](https://smart-health-checkin.org/connectathon/results.html) is rebuilt from those issues.
