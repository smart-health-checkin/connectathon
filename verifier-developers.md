# Verifier developers

For teams building the clinic side (EHRs, portals, and other Verifiers): the check-in page, portal, kiosk, or app that asks a patient's wallet for data.

## Background

In the spec's terms you build a **Verifier**. Your page sends a request listing the items you'd like, and the patient's wallet answers with the records and form answers the patient chose to share, plus a status for every item. The wallet can be an app on the phone, reached through the browser's Digital Credentials API, or a website, opened in a tab (the [web wallet hand-off](wallet-developers.html#web-wallets)).

The answer comes back encrypted to a key your page made for that request, and bound to your page's origin. You check it against your request, then show it to staff. Each item and record is judged on its own, so one bad record doesn't lose the rest.

## Get started

1. **Learn the model.** [Request and response](https://smart-health-checkin.org/spec/smart-model-explainer.html) walks through what a clinic asks for and what comes back, in about ten minutes.
2. **Build your page.** The [client library tutorial](https://smart-health-checkin.org/client/docs/tutorial.html) builds a working check-in page end to end. Try the [reference EHR demo](https://smart-health-checkin.org/client/demo/) to see the result.
3. **Test against known-good wallets.** Point your page at the event's [wallet registry](scenarios.html#wallet-registry) and check in with the [SMART Testing Wallet](testing-wallet/). It can also send deliberately broken responses, so you can test your error handling.
4. **Building a native app instead of a web page?** The [Native apps guide](https://smart-health-checkin.org/client/docs/native-apps.html) shows both ways: calling phone wallets directly, and running the web flow in a browser tab to reach web wallets too.
5. <a id="register"></a>**Register your check-in page or app** with the [registration form](register/), as a Verifier (role `verifier`). Verifier is the side that asks for data: EHR check-in pages, patient portals, kiosks, and clinic apps all register as Verifiers. The form opens a pull request that adds you to the [directory](directory.html), so wallet teams can test against you. A web page lists its URL; a phone app lists its platforms and how testers get it ([examples](register/#verifier-examples)).
6. **Run the scenarios.** The [test scenarios](scenarios.html) list the [baseline requests](scenarios.html#baseline-requests) and what passing looks like, starting with the [minimum scenarios](scenarios.html#minimum-scenarios), M1 to M6.
7. **Share what you found** from the [developer track](share.html#developers) of the share page ([details below](#share-what-you-found)).

## Joining

- **Register:** [register your check-in page or app](register/) ([step 5 of Get started](#register)), ideally a week before the event.
- **The live event:** on Zoom; the date, time, and link are on the [main page](./). Join the main room for the opening, the hourly check-ins, and the closing report-out. Pair with wallet teams in breakout rooms you start yourself ([how](./#how-the-event-works)).
- **Questions:** ask in the [#kill-the-clipboard channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT) on the CMS Health Tech Ecosystem Slack.

## Share what you found

Debrief your testing from the [developer track](share.html#developers) of the share page: it has a debrief prompt for any AI assistant, and the experience form. Record each formal scenario run as a [structured result](scenarios.html#recording-results) too. Reports are public, credited with the name and organization you give.

## Reference

### What you build

The practice system. Its check-in page builds a request, lets the patient choose a wallet, and handles the response in the same page.

1. **Build the request.** A small JSON document listing the items you want: records by FHIR profile, or a form to fill in. ([§5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model))
2. **Wrap it and create a one-time key.** The request goes inside an mdoc request, and the page makes a fresh encryption key for the answer. ([§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction))
3. **Send it to the wallet the patient picked.** A native wallet goes through the browser's Digital Credentials API. A web wallet goes through the [web wallet hand-off](wallet-developers.html#web-wallets). ([VRQ-8](https://smart-health-checkin.org/spec/#VRQ-8))
4. **Decrypt the answer and check its signatures.** Signature and other mdoc-layer problems are warnings to report, not reasons to reject ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)).
5. **Check the answer against the request, then show it to staff.** ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation))

The [client library](https://smart-health-checkin.org/client/) does [steps 2 to 5 above](#what-you-build) for JavaScript pages: drop in `<smart-checkin-picker>`, or call `runCheckin`. Install it from its [latest release](https://github.com/smart-health-checkin/client/releases/latest); each release lists its install line.

<details class="smart-details">
<summary>Reference: identifiers and checks</summary>

| What | Value | Spec |
|---|---|---|
| Request fields | `type`, `version`, `id`, `items[]`. Each item has `id`, `title`, `content`, `accept[]`. | [§5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model) |
| Where the request goes | `ItemsRequest.requestInfo["org.smarthealthit.checkin.request"]`, as a JSON string | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| mdoc `docType` | `org.smarthealthit.checkin.1` | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| mdoc namespace and element | `org.smarthealthit.checkin`, `smart_health_checkin_response` | [§8.1](https://smart-health-checkin.org/spec/#8-1-identifiers-and-constants) |
| `DeviceRequest` | version `1.0`, with the `ItemsRequest` tag-24 wrapped | [§8.7](https://smart-health-checkin.org/spec/#8-7-message-structures) |
| Encryption | a fresh P-256 HPKE key per request, sent in a CBOR `encryptionInfo` with a nonce | [§8.2](https://smart-health-checkin.org/spec/#8-2-verifier-request-construction) |
| Digital Credentials API argument | `{ protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }` | [VRQ-8](https://smart-health-checkin.org/spec/#VRQ-8) |
| Session transcript | built from the exact `encryptionInfo` string and the page's origin | [§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript) |
| Response checks | HPKE opens; `DeviceResponse` version and status; issuer signature; device signature; value digest | [§8.5](https://smart-health-checkin.org/spec/#VRS-0) |
| Cross-checks | `requestId` matches; one status per item; every artifact's media type accepted by the items it fulfills | [§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation) |

</details>
