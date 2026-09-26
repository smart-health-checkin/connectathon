# Agent notes: connectathon

Connectathon scenarios, the Testing EHR (`testing-ehr/`), the SMART Testing
Wallet (`testing-wallet/`), the participant registry (`participants/`), and
results. Deploys to smart-health-checkin.org/connectathon/ on every push to
`main`, hourly, and when issues change.
[MAINTAINING.md](https://github.com/smart-health-checkin/smart-health-checkin.github.io/blob/main/MAINTAINING.md) maps every repo, what triggers what, and how to release.

- Check: `bun install && bun run check && bun test tests && bunx tsc --noEmit -p .`.
  Build: `bun run build`.
- Conformance: `tests/conformance/` runs the spec's conformance cases
  (`hpke-open`, `mdoc-verify`) through the Testing EHR's own checks;
  `known-failures.json` lists what fails today and must shrink as fixes land.
- After changing the Testing EHR or testing wallet: `bun scripts/self-test.ts`
  (the live site), or `bun scripts/self-test.ts http://localhost:8794/` against
  a local build whose `_site/wallets.json` points at the local testing wallet.
  It also runs after every deploy and nightly.
- Android: `bun scripts/android-e2e.ts --release` against an emulator or
  device; nightly in CI (`android-e2e.yml`) with the latest APK.
- The client library is pinned to a release tarball in `package.json`.
  Bump the URL to upgrade; nothing updates it automatically.
- Participants edit their own `participants/*.json` by PR;
  `participant-pr.yml` validates and auto-merges owners' changes.
- This section's menu is `nav.json`.
