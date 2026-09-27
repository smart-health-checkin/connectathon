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
- After changing the Testing EHR or Testing Wallet: `bun scripts/self-test.ts`
  (the live site), or `bun scripts/self-test.ts http://localhost:PORT/connectathon/`
  against a local build served under `/connectathon/` (with `/assets/` from the
  apex repo, and `_site/404.html` with status 404 for missing paths, as GitHub
  Pages does), whose `_site/wallets.json` points at the local Testing Wallet.
  It also runs after every deploy and nightly.
- **Test tools talk only through the protocol.** No side channels between
  Verifier and wallet test tools: the Testing EHR opens every wallet at the URL
  it's given and judges every response the same way, and never passes settings
  to a wallet any other way (URL fragments or parameters it makes up, shared
  storage, special-casing a wallet's id). The Testing Wallet's test options come
  only from its own testing panel and its documented
  [config URLs](testing-wallet/FEATURES.md#config-urls)
  (`testing-wallet/src/config.ts`); the EHR's optional "Testing Wallet options"
  builds those public URLs with that module, as a tester would, and nothing
  else in the EHR knows about them. Expected outcomes of test cases live in
  `scripts/self-test.ts`, not in either tool.
- `catalog.json` holds the test cases, each named by a short kebab-case `id` (the anchor,
  the Testing EHR's `#case=`, and the result form's scenario): `tier` (`minimum` cases go
  on the front page, `index.md`; `advanced` ones on `scenarios.md`), an optional `group`
  (the section of its page), `request`, an optional `walletStep` (text for the
  person using the wallet, and the Testing Wallet config that does it), `expect` (checks
  on the response, defined and evaluated in `testing-ehr/src/cases.ts`), and what to look
  for by eye. Its `requests` says in plain words what each file in `requests/` asks for;
  the scenario pages, the Test requests page, and the Testing EHR's request menu use it.
  The build validates the catalog and writes each case's block where its page has
  `<!-- test cases: TIER -->` (cases with no group) or `<!-- test cases: TIER GROUP -->`, failing if a case is
  missing or on the wrong page; link a case with `caseHref` from `cases.ts`. Run
  `bun scripts/sync-issue-form.ts` after changing it.
- `_site/404.html` is the Testing Wallet page with a `<base>` at `testing-wallet/`,
  so its config URLs (`testing-wallet/<base64url JSON>/`) load it; any other
  missing address goes on to `not-found.html` (`scripts/build.ts`).
- Android: `bun scripts/android-e2e.ts --release` against an emulator or
  device; nightly in CI (`android-e2e.yml`) with the latest APK.
- The client library is pinned to a release tarball in `package.json`.
  Bump the URL to upgrade; nothing updates it automatically.
- Participants edit their own `participants/*.json` by PR;
  `participant-pr.yml` validates and auto-merges owners' changes.
- `main` has a ruleset ("Protect main") that blocks force-pushes and deleting
  the branch. Direct pushes and the workflows' pushes and merges still work;
  never rewrite `main`'s history.
- Pages: `index.md` is the front page (a hub with the minimum scenarios, linking to
  one page per participant type); `patients.md`, `clinic-staff.md`, `verifier-developers.md`,
  `wallet-developers.md`, and `observers.md` are those pages; `scenarios.md` (the Testing
  guide: how to test, ground rules, the other scenarios, recording results, and shared
  resources) is the developer test reference. `scripts/build.ts` renders each; add a new page there
  and in `nav.json`.
- Every page uses the apex's shared chrome (see "The shared site" in MAINTAINING.md):
  content pages get the site bar, breadcrumb, `<main id="main">`, and footer from
  `page()` in `scripts/build.ts`; the Testing EHR, Testing Wallet, and Register use
  the tool bar (`data-smart-topbar="tool"`, actions in `data-smart-tool-actions`),
  and the build adds the chrome's `<head>` tags after bundling. Each page's H1 uses
  its menu wording. Page CSS must not style bare `header` or `nav`; use rem, not
  `ch`, for layout widths.
- Undecided event details are written `{{TBD: what}}` in the page Markdown and
  render as a "To be announced" pill; any other `{{` in a page fails the build.
- This section's menu is `nav.json`.
- The Testing Wallet's option tables in `testing-wallet/FEATURES.md` (faults, config JSON fields) are
  generated from `testing-wallet/src/config.ts`: change the code, then `bun run docs`; `bun run check` fails if
  they differ.
- `bun run build` ends with `scripts/llms.ts`, which writes `llms.txt`: the apex's shared
  background (fetched from `https://smart-health-checkin.org/llms-background.md`;
  `LLMS_BACKGROUND=../smart-health-checkin.github.io/llms-background.md` builds offline), every
  page in `nav.json` order as Markdown, and the prompts as published. A new page must be in
  `nav.json` or the script's `PAGES` or `SKIP`, or the build fails. A new prompt must be in
  `scripts/links.ts` to be included; one listed there without its file fails the build. See
  [llms.txt](https://github.com/smart-health-checkin/smart-health-checkin.github.io/blob/main/MAINTAINING.md#llmstxt)
  in MAINTAINING.md.
- Experience reporting (the main feedback path; reports are public):
  - `prompts/*.md` are prompts people paste into any AI assistant (patient guide,
    implementer debrief). Keep them assistant-neutral and under ~1,500 words.
    `{{FORM_URL}}` is filled in at build time; the build fails on any other `{{…}}`.
  - `scripts/links.ts` is the one place for the form URL and the prompt list
    (title, who it's for, what it does). Adding a prompt = a file in `prompts/`
    plus an entry there.
  - `share.html` is generated by `scripts/build.ts` (`sharePage`): Copy, Open in
    Claude / ChatGPT (the prompt rides in `?q=` when the URL stays under 12,000
    characters, which both prompts do; otherwise the page says to paste; Claude shows a
    caution banner for linked prompts, and the page says that's expected), and the form.
  - `tools/experience-form/form.gs` rebuilds the Google Form in place (bound
    script, `forms.currentonly` scope). Change the form there, then match any
    wording the prompts and share page repeat (public-reports notice, fields).
  - Apps link to `share.html#from=…&result=…&time=…` after an outcome ("Tell us
    how it went"); the page turns that into a note to paste. Not a structured report.
  - Patient-demo steps in the patient prompt must match the live client demos;
    re-walk them after changing a demo.

