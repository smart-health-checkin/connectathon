# Web wallet hand-off

How an EHR's check-in page and a web wallet exchange a SMART Health Check-in request and response when the wallet is a website instead of an app on the phone.

Only the transport differs from a native wallet. The EHR opens the wallet in a tab, and the two pages talk with `postMessage`. The SMART request and response, the mdoc wrapping, and the encryption are exactly what the Digital Credentials API carries ([spec §8](https://smart-health-checkin.org/spec/#8-same-device-presentation-flow)).

The [client library](https://smart-health-checkin.org/client/docs/web-wallet-handoff.html) implements both sides: `webWallet` (or `<smart-checkin-picker>`) for the EHR page, and `serveWebWallet` for a wallet. Its page on the hand-off is the canonical copy.

## Sequence

1. The EHR opens the wallet in a new tab.
2. The wallet posts **ready**.
3. The EHR posts the **request**.
4. The patient reviews and chooses in the wallet.
5. The wallet posts the **response** and may close itself.
6. The EHR decrypts and checks the response, as it would a native wallet's.

## Opening the wallet

- Call `window.open(walletUrl)` inside the patient's click handler. Browsers block it otherwise.
- `walletUrl` comes from the [wallet registry](wallets.json).
- The default is a new tab. A registry entry with `"target": "popup"` asks for a popup window.
- Keep the returned window reference. It is how the EHR recognizes the wallet's messages.

## The three messages

### Ready: wallet → EHR

Sent by the wallet as soon as it loads.

```js
window.opener.postMessage({ type: "digital-credentials/web-wallet/ready" }, "*");
```

It carries no data, so `"*"` is safe here.

### Request: EHR → wallet

Sent by the EHR after `ready`, to the wallet's origin only.

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

### Response: wallet → EHR

Sent once, to the EHR's origin only. One of three outcomes:

```js
// The patient shared
{ type: "digital-credentials/web-wallet/response", requestId, outcome: "approved",
  credential: { protocol: "org-iso-mdoc", data: { response } } }

// The patient cancelled
{ type: "digital-credentials/web-wallet/response", requestId, outcome: "declined" }

// Something failed
{ type: "digital-credentials/web-wallet/response", requestId, outcome: "error", message: "<what went wrong>" }
```

`response` is the base64url `dcapiResponse`, exactly what a native wallet returns ([A.2](https://smart-health-checkin.org/spec/#a-2-digital-credentials-api-wrappers)).

## The EHR's origin

The wallet learns who is asking from the browser, never from the message.

- Accept a request only when `event.source === window.opener`.
- Use `event.origin` as the EHR's origin. The message has no origin field, and a wallet must never trust one written inside a message.
- Reject the opaque origin `"null"`. There is no way to reply to it.
- Show that origin to the patient during consent.
- Bind the `SessionTranscript` to it ([§8.3](https://smart-health-checkin.org/spec/#8-3-sessiontranscript)).
- Reply only to that origin.

## Processing in the wallet

Same as a native wallet ([§8.4](https://smart-health-checkin.org/spec/#8-4-wallet-request-handling-and-response-construction)):

- Pick the entry in `digital.requests` whose `protocol` is `org-iso-mdoc`.
- Validate the request.
- Ask the patient item by item.
- Build the SMART response and HPKE-encrypt the `DeviceResponse` ([§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)).

## Timeouts and closing

- The EHR treats the wallet window closing before a response as a decline.
- The EHR also gives up after a timeout. The client library uses five minutes.
- A wallet can't extend the timeout in this version, even for a long form.

## Checklist

For an EHR:
- Open the wallet only during a user click, and keep the window reference.
- Filter every incoming message by `event.source`, `event.origin`, and `requestId`.
- Send the request only to the wallet's origin, never to `"*"`.
- Validate an approved response as in [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing) and [§8.6](https://smart-health-checkin.org/spec/#8-6-validation-checklist).

For a web wallet:
- Post `ready` to `window.opener` on load.
- Take the EHR origin from `event.origin`, show it, and bind the transcript to it.
- Reply only to that origin, with the same `requestId`.
- Send `declined` or `error` rather than closing silently.
