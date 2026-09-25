# Web wallet hand-off

How an EHR's check-in page and a web wallet exchange a SMART Health Check-in request and response when the wallet is a website instead of an app on the phone.

The request and response carried here are exactly the ones a native wallet gets from the Digital Credentials API ([spec §8](https://smart-health-checkin.org/spec/#8-same-device-presentation-flow)). Only the transport differs: the EHR opens the wallet in a tab, and the two pages talk with `postMessage`. Nothing below changes the SMART request or response, the mdoc wrapping, or the encryption.

The [client library](https://smart-health-checkin.org/client/docs/wallets.html) implements the EHR side as `createWebWalletCredentialGetter`.

## Sequence

1. **The EHR opens the wallet.** During the patient's click, the EHR calls `window.open(walletUrl)`, with `walletUrl` taken from the [wallet registry](wallets.json). Browsers only allow this during a real click. The default is a new tab; a registry entry with `"target": "popup"` asks for a popup window.
2. **The wallet says it's ready.** Once loaded, the wallet posts to its opener:
   ```js
   window.opener.postMessage({ type: "digital-credentials/web-wallet/ready" }, "*");
   ```
   This message carries no data, so `"*"` is safe. The EHR accepts it only when `event.source` is the window it opened and `event.origin` is the origin of `walletUrl`.
3. **The EHR sends the request** to the wallet window, with `targetOrigin` set to the wallet's origin:
   ```js
   walletWindow.postMessage({
     type: "digital-credentials/web-wallet/request",
     requestId: "<opaque, unique per request>",
     credentialRequestOptions: {
       digital: { requests: [
         { protocol: "org-iso-mdoc", data: { deviceRequest, encryptionInfo } }
       ] }
     }
   }, walletOrigin);
   ```
   `credentialRequestOptions` is the same argument the EHR would pass to `navigator.credentials.get` ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers)).
4. **The wallet takes the EHR's origin from the browser.** The wallet accepts the request only when `event.source === window.opener`, then records `event.origin` as the EHR's origin. It shows that origin to the patient during consent and uses it in the `SessionTranscript` ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript)). The message carries no origin field, and a wallet must never use an origin written inside a message. A wallet rejects an opaque origin (`"null"`), because it cannot reply to it.
5. **The wallet processes the request** exactly as a native wallet does ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction)). It picks the entry in `digital.requests` whose `protocol` is `org-iso-mdoc`, validates it, gets the patient's consent item by item, builds the SMART response, and HPKE-encrypts the `DeviceResponse` ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)).
6. **The wallet replies** to the EHR window, with `targetOrigin` set to the recorded EHR origin:
   ```js
   window.opener.postMessage({
     type: "digital-credentials/web-wallet/response",
     requestId: "<same as the request>",
     outcome: "approved",
     credential: { protocol: "org-iso-mdoc", data: { response } }
   }, ehrOrigin);
   ```
   `response` is the base64url `dcapiResponse`, exactly what a native wallet returns ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers)).

   When the patient cancels, send `{ type, requestId, outcome: "declined" }`. When something fails, send `{ type, requestId, outcome: "error", message: "<what went wrong>" }`.
7. **The EHR finishes.** It accepts the response only from the wallet window and origin, with a matching `requestId`, then opens and validates it as it would a native wallet's ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing), [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist)). The wallet may close its own window after replying.

## Timeouts and closing

The EHR treats the wallet window closing before a response as a decline. It should also give up after a timeout; the client library uses five minutes. A wallet that needs longer, for example while the patient answers a long form, has no way to extend it in this version.

## Checklist

For an EHR:
- Open the wallet only during a user click, and hold on to the window reference.
- Filter every incoming message by `event.source`, `event.origin`, and `requestId`.
- Send the request only to the wallet's origin, never to `"*"`.

For a web wallet:
- Post `ready` to `window.opener` on load.
- Take the EHR origin from `event.origin` on the request, show it, and bind the transcript to it.
- Reply only to that origin, with the same `requestId`.
- Send `declined` or `error` rather than closing silently.
