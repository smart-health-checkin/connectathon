# How to register for the connectathon

Each participating organization has one file in [`participants/`](participants/), named after the organization, such as `participants/example-health.json`. It lists your components: EHR check-in pages, web wallets, and native wallets. The site builds the [directory](https://smart-health-checkin.org/connectathon/directory.html) from these files, and generates the [wallet registry](https://smart-health-checkin.org/connectathon/wallets.json) from the web wallets in them.

## Add or change your file

1. Copy [`participants/smart-health-it.json`](participants/smart-health-it.json) as a starting point. The fields are defined in [`participants/schema.json`](participants/schema.json).
2. Edit it in the GitHub web editor or locally, then open a pull request.
3. A check runs on the pull request and reports any problem with the file. A maintainer merges it once it passes. On the event day, merges happen within minutes.

If you'd rather not use GitHub, post your file's contents in `#kill-the-clipboard` on the CMS Health Tech Ecosystem Slack and a maintainer will add it.

Everything in your file is public. Only list contact details you're happy to publish.

## Fields for each component

| Role | Required | Notes |
|---|---|---|
| `ehr` | `id`, `name`, `status`, `url` | `url` is your public check-in page. |
| `web-wallet` | `id`, `name`, `status`, `walletUrl` | `walletUrl` is the page an EHR opens. It follows the [web wallet hand-off](https://smart-health-checkin.org/connectathon/web-wallet-handoff.html). Add `testPatient` and optionally `iconUrl` and `target`. |
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
