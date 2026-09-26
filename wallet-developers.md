# Wallet developers

For teams building the patient side: a health app on a phone, or a web wallet that runs in a browser tab.

## Background

In the spec's terms you build a **Wallet**. A clinic's page sends a request listing the items it would like. Your app shows it to the patient, lets them choose what to share item by item, and answers with the chosen records and form answers, plus one status for every item.

Your answer is signed and encrypted to a key the clinic's page made for that request, and bound to that page's origin, which you take from the platform, never from the request ([TR-3](https://smart-health-checkin.org/spec/#TR-3)). Build exactly what [§8](https://smart-health-checkin.org/spec/#8-same-device-presentation-flow) describes; a strict mdoc verifier should accept it.

## Get started

1. **Learn the model and the wire format.** [Request and response](https://smart-health-checkin.org/spec/request-response.html) covers what a clinic asks for and what comes back; [Wire protocol](https://smart-health-checkin.org/spec/wire-protocol.html) covers the encrypted, signed envelope.
2. **Read the wallet guide.** [Wallet guide](https://smart-health-checkin.org/client/docs/build-a-wallet.html) covers matching records to items, forms, statuses, and web wallets built with the client library.
3. **Compare with the reference.** The [reference Android wallet](scenarios.html#reference-android-wallet) (install link and test patients) and its [source](https://github.com/smart-health-checkin/android-wallet); for web wallets, the [SMART Testing Wallet](testing-wallet/).
4. **Run the conformance tests.** The spec's [conformance tests](https://github.com/smart-health-checkin/spec/tree/main/conformance) test one capability at a time, without a browser or a partner.
5. **Test against the Testing EHR.** The [Testing EHR](testing-ehr/) sends any scenario's request to your wallet and checks the answer against the spec, each check linked to its requirement.
6. <a id="register"></a>**Register your wallet** with the [registration form](register/). It opens a pull request that adds you to the [participant directory](directory.html). Only web wallets go into the event [registry](scenarios.html#wallet-registry) (`wallets.json`), because Verifier pages open them directly. A native wallet is reached through the phone's own wallet chooser, so it's listed in the directory only, with its platforms and how testers get it: an install link, an invite on request, or testing with you on your phone. It needs no public build ([example](register/#native-wallet-example)).
7. **Run the scenarios.** The [test scenarios](scenarios.html) list the [baseline requests](scenarios.html#baseline-requests) and what passing looks like, starting with the [minimum scenarios](scenarios.html#minimum-scenarios), M1 to M6.
8. **Share what you found** from the [developer track](share.html#developers) of the share page ([details below](#share-what-you-found)).

## Joining

- **Register:** [register your wallet](register/) ([step 6 of Get started](#register)), ideally a week before the event.
- **The live event:** on Zoom; the date, time, and link are on the [main page](./). Join the main room for the opening, the hourly check-ins, and the closing report-out. Pair with EHR teams in breakout rooms you start yourself ([how](./#how-the-event-works)).
- **Questions:** ask in the [#kill-the-clipboard channel](https://app.slack.com/client/E09AR4N78GN/C09BPE4NXPT) on the CMS Health Tech Ecosystem Slack.
- **Devices:** native-wallet testing needs your own phone: Android with Chrome, or an iPhone with Safari 26.

## Share what you found

Debrief your testing from the [developer track](share.html#developers) of the share page: it has a debrief prompt for any AI assistant, and the experience form. Record each formal scenario run as a [structured result](scenarios.html#recording-results) too. Reports are public, credited with the name and organization you give.

## Reference

### Native wallets

A health app installed on the phone. The browser passes it the EHR's request through the Digital Credentials API, and the phone shows it as a choice to the patient. On Android, the app [registers with Credential Manager](https://smart-health-checkin.org/spec/platform-notes.html#android), and a small matcher decides whether it can answer a request.

1. **Check the request.** ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction))
2. **Ask the patient, item by item.** `required: true` is the clinic's advice, not consent ([HOLD-3](https://smart-health-checkin.org/spec/#HOLD-3)).
3. **Build the answer**, with one status per item and the records or form answers the patient chose. ([§6.1](https://smart-health-checkin.org/spec/#6-1-normative-typescript-model), [§6.2](https://smart-health-checkin.org/spec/#6-2-artifact-and-status-semantics))
4. **Sign and encrypt it for the EHR**, bound to the origin the phone reports. ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction), [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing))

<details>
<summary>Reference: what the wallet checks and produces</summary>

| What | Detail | Spec |
|---|---|---|
| Request checks | the `DeviceRequest`, the tag-24 `ItemsRequest`, and the SMART request in its `requestInfo` | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Origin | taken from the platform, never from the request | [§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript) |
| Response location | the SMART response JSON as an issuer-signed item, element `smart_health_checkin_response` | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Signatures | issuer signature over the MSO; device signature over the session | [§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction) |
| Encryption | HPKE to the EHR's key from `encryptionInfo`, with the session transcript as `info` | [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing) |

</details>

For Android, see the [platform notes](https://smart-health-checkin.org/spec/platform-notes.html#android): registering with Credential Manager, the matcher, the browser allowlist, and the large-response API. The same page covers iOS, where a wallet needs Apple's approval for this document type.

### Web wallets

A health app that runs as a website. It does the same work as a native wallet, but the EHR reaches it by opening it in a tab instead of through the Digital Credentials API. The two pages exchange three messages:

1. **Ready.** The wallet tells the EHR page it has loaded.
2. **Request.** The EHR page sends the same request a native wallet would get.
3. **Response.** The wallet sends back the same encrypted answer a native wallet would return, or says the patient declined or something failed.

The wallet learns which page is asking from the browser (`event.origin`), never from the message itself. It shows that origin to the patient and binds the answer to it. ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript))

<details>
<summary>Reference: the three messages</summary>

Ready, from the wallet to its opener:

```js
{ type: "digital-credentials/web-wallet/ready" }
```

Request, from the EHR page to the wallet's origin:

```js
{
  type: "digital-credentials/web-wallet/request",
  requestId: "<opaque>",
  credentialRequestOptions: {
    digital: { requests: [{ protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }] }
  }
}
```

Response, from the wallet to the EHR page's origin:

```js
{
  type: "digital-credentials/web-wallet/response",
  requestId: "<same as the request>",
  outcome: "approved",   // or "declined", or "error" with a message
  credential: { protocol: "org-iso-mdoc", data: { response } }
}
```

</details>

The full hand-off, with timeouts and a checklist, is at <https://smart-health-checkin.org/client/docs/web-wallets.html>.
