# SMART Testing Wallet: features and behavior

The SMART Testing Wallet, served at
<https://smart-health-checkin.org/connectathon/testing-wallet/> and listed in
the connectathon wallet registry. It behaves like a real wallet by default. A
[testing panel](#testing-panel) and [config URLs](#config-urls) add test
options for exercising a Verifier's error handling.

## Hand-off

- Built on the client library's `serveWebWallet` (hand-off) and `selectEntries` (matching), so this wallet exercises the library's wallet side.

- Implements the messages in the client docs' [Web wallets](https://smart-health-checkin.org/client/docs/web-wallets.html) page: post `ready` to
  the opener on load, accept one `request`, reply once with `approved`,
  `declined`, or `error`.
- Accepts a request only from `window.opener`. Takes the EHR's origin from
  `event.origin`, rejects the opaque origin `"null"`, and never reads an origin
  from the message body.
- Shows the EHR's origin at the top of the consent screen.
- Replies only to that origin, with the request's `requestId`.
- Opened without an opener, the page explains what it is and links to the
  [Testing EHR](https://smart-health-checkin.org/connectathon/testing-ehr/) and the [clinic check-in demo](https://smart-health-checkin.org/client/demo/).

## Request handling

- Picks the `org-iso-mdoc` entry from `credentialRequestOptions.digital.requests`
  and parses the `DeviceRequest` and `encryptionInfo` with the client library.
- Validates the SMART request (spec [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model)). If it's malformed, shows the problem
  and replies `error` with the validator's message.
- Unknown selector kinds make that item `unsupported`. The other items are
  still answered ([§5.4.3](https://smart-health-checkin.org/spec/#5-4-3-extension-selectors)).

## Patients

- Two synthetic patients from `data/`, chosen at the top of the consent screen:
  - **Aria Test**: demographics, three problems, two allergies, three
    medications, three immunizations, lab and vital signs, and insurance.
  - **Aria Test, large record**: the same, plus eight years of labs,
    blood pressures, and progress notes. Used for scenario [large-response](https://smart-health-checkin.org/connectathon/scenarios.html#large-response), which tests
    that large responses arrive intact.
- Every resource claims its US Core profile. Patient, Coverage, and the payer
  also claim the CARIN digital insurance card profiles. Both files validate
  with the latest HL7 validator (`scripts/validate-fhir.sh`).

## Matching ([§5.4.1](https://smart-health-checkin.org/spec/#5-4-1-selection-fhir), [§5.5](https://smart-health-checkin.org/spec/#5-5-canonical-version-handling))

- `profiles`: a resource matches when its `meta.profile` includes the
  requested canonical. An unversioned request matches any version. A
  versioned request needs that exact version.
- `profilesFrom`: a resource matches when any of its profiles is under the
  family URL, for example `http://hl7.org/fhir/us/core/StructureDefinition/…`
  for `http://hl7.org/fhir/us/core`.
- `profiles` and `profilesFrom` together are additive. `resourceTypes` narrows
  either one, or on its own selects by type.
- No selector at all: everything is offered and the patient picks.
- Supporting resources that a match references, such as the prescriber on a
  MedicationRequest or the payer on a Coverage, go in the same Bundle so
  references resolve.
- Nothing matches: status `unavailable`.

## Forms ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir))

- Renders the inline Questionnaire. Without an inline body, fetches an
  unversioned canonical directly. For a versioned canonical, it fetches the
  base URL and uses the result only if `version` matches. Anything else is
  `unsupported`.
- Shows each item's `text`, never a code's `display`.
- Item types: display, group, boolean, integer, decimal, string, text, date,
  choice, and open-choice (options plus free text), with `repeats` shown as
  checkboxes. `enableWhen` with `=`, `!=`, and `exists`, and `enableBehavior`
  `any` or `all`. `required` is marked but never blocks sending.
- Builds a QuestionnaireResponse, status `completed`, whose `questionnaire`
  echoes the requested canonical exactly, including any `|version`. Hidden
  items and unanswered items are left out.
- Prefill ([prefilled-form](https://smart-health-checkin.org/connectathon/scenarios.html#prefilled-form)): an item carrying a LOINC code the record has an Observation
  for starts filled in and marked as prefilled.

## Consent

- One card per item: title, summary, and what would be shared, counted by
  resource type (including records the response size setting adds). A share/don't-share switch, defaulting to share.
- `required: true` is shown as "the request marks this as required" and changes
  nothing else.
- Items the patient switches off become `declined`.
- "Decline all" answers with every item `declined` and no artifacts
  ([HOLD-4](https://smart-health-checkin.org/spec/#HOLD-4)). Closing the tab
  without answering is the cancel path: the EHR's call fails.

## Response ([§6](https://smart-health-checkin.org/spec/#6-clinical-response-model))

- Exactly one status per item.
- Only media types the item accepts
  ([ACC-2](https://smart-health-checkin.org/spec/#ACC-2)). Selection items use
  the earliest type in `accept` this wallet can produce
  ([ACC-3](https://smart-health-checkin.org/spec/#ACC-3)): one
  `application/fhir+json` Bundle per item, or a SMART Health Card. An item that
  accepts neither type, or a form that doesn't accept `application/fhir+json`,
  is answered `unsupported`.
- Form items become one QuestionnaireResponse.
- One artifact for several items ([shared-artifact](https://smart-health-checkin.org/connectathon/scenarios.html#shared-artifact)), on the testing panel: allergies and
  medications share one Bundle whose `fulfills` lists both.
- Sealed with the client library, with the transcript bound to the EHR origin.

## SMART Health Cards

- Signed with the test issuer
  `https://smart-health-checkin.org/connectathon/testing-wallet/issuer`. Its
  public key is at `issuer/.well-known/jwks.json`. The private key sits in the
  page, because this is a test issuer and anyone may mint cards with it.
- Standard SMART Health Card JWS: header `zip: DEF`, `alg: ES256`, `kid`; the
  payload is a raw-deflated `vc` with a FHIR Bundle using `resource:N`
  references.

## Testing panel

Collapsed unless test options are on. When they are, the approval screen says
which ones at the top, with a **Reset to normal** button. Changes on the panel
apply to this tab; to use a set of options again, use a [config URL](#config-urls).

- Response size: Normal, 512 KB, 1 MB, 2 MB, or 5 MB. It tests that large
  responses work. The wallet picks one shared item answered with a FHIR Bundle,
  preferring one with Observations, then MedicationRequests, then
  Immunizations, then Conditions, and adds earlier copies of that item's
  records of that kind (new ids, dates stepped back over about ten years, past
  prescriptions `completed`, lab and vital values varied a little) until the
  base64url `data.response` reaches about the chosen size. The response stays
  valid, so a Verifier that follows the spec accepts it. The approval screen
  shows the size of the response Share would send and what the setting added,
  and that item's card counts the added records; the response panel below
  summarizes them. A request with no such item (only forms, or only SMART
  Health Cards) is sent at its normal size, and the approval screen says so.
- Force a status per item: fulfilled, partial, unavailable, declined,
  unsupported, or error.
- Faults, each with how a Verifier that follows the spec reacts
  ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation),
  [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)):

  <!-- generated: faults -->
  | Fault | What it does | The Verifier |
  | --- | --- | --- |
  | `wrong-canonical` | QuestionnaireResponse.questionnaire doesn't match the request | sets that record aside ([XV-10](https://smart-health-checkin.org/spec/#XV-10)) |
  | `missing-status` | Leave one item without a status | treats that item as unknown ([XV-3](https://smart-health-checkin.org/spec/#XV-3)) |
  | `duplicate-status` | Give one item two statuses | treats that item as unknown ([XV-3](https://smart-health-checkin.org/spec/#XV-3)) |
  | `wrong-request-id` | requestId doesn't match | rejects the response ([XV-2](https://smart-health-checkin.org/spec/#XV-2)) |
  | `unaccepted-media-type` | Return an artifact in a media type the item didn't accept | sets that record aside ([XV-7](https://smart-health-checkin.org/spec/#XV-7)) |
  | `bad-signature` | Corrupt the issuer signature | warns and continues ([VRS-5](https://smart-health-checkin.org/spec/#VRS-5)) |
  | `bad-encryption` | Corrupt the HPKE ciphertext | rejects the response ([VRS-3](https://smart-health-checkin.org/spec/#VRS-3)) |
  | `wrong-origin` | Bind the transcript to the origin with a trailing slash | rejects the response ([VRS-3](https://smart-health-checkin.org/spec/#VRS-3)) |
  | `bad-shc-signature` | Break the SMART Health Card signature | sets that card aside ([XV-13](https://smart-health-checkin.org/spec/#XV-13)) |
  | `combine-allergies-meds` | Answer allergies and medications with one shared Bundle (scenario shared-artifact) | passes |
  <!-- /generated -->
- **Copy wallet URL for these settings:** the [config URL](#config-urls) for
  what the panel shows now.
- Shows the parsed request, and the SMART response as sent.

## Config URLs

This wallet's own URL format for starting with test options. It is not part of
SMART Health Check-in: a Verifier opens the URL like any other wallet URL, and
nothing in the protocol carries or needs these options.

```
https://smart-health-checkin.org/connectathon/testing-wallet/                      normal
https://smart-health-checkin.org/connectathon/testing-wallet/<base64url JSON>/     starts with that config
```

To test your Verifier's error handling, add a config URL to your page's wallet
list as a web wallet (for example with `webWallet({ id, name, walletUrl })` in
the client library, or the Testing EHR's "Add a wallet by URL"), then run
check-ins from your page as usual. Every check-in sent to that URL gets those
options, and the wallet's approval screen shows them.

### The JSON

An object. Every field is optional; a missing field means normal.

<!-- generated: config-fields -->
| Field | Value | What it does |
| --- | --- | --- |
| `faults` | array of fault names: `wrong-canonical`, `missing-status`, `duplicate-status`, `wrong-request-id`, `unaccepted-media-type`, `bad-signature`, `bad-encryption`, `wrong-origin`, `bad-shc-signature`, `combine-allergies-meds` | Turns those faults on ([Faults](#testing-panel)) |
| `status` | object of request item id to `"fulfilled"`, `"partial"`, `"unavailable"`, `"declined"`, `"unsupported"`, or `"error"` | Forces that item's status; ids not in the request are ignored |
| `size` | `"512k"`, `"1m"`, `"2m"`, or `"5m"` (512 KB, 1 MB, 2 MB, 5 MB) | The response size setting |
| `patient` | `"aria"` or `"large"` (Aria Test; Aria Test, large record); the first is the default | Which synthetic patient answers |
<!-- /generated -->

Any other field or value is an error.

### Encoding

The path segment is the JSON's UTF-8 bytes in base64url (RFC 4648 §5) without
`=` padding, followed by `/`. The wallet's panel writes the JSON with no spaces,
fields in the order `faults`, `status`, `size`, `patient`, and faults sorted, so
one set of options has one URL; the wallet reads any valid JSON.
`testing-wallet/src/config.ts` is the one implementation: the wallet, the
Testing EHR's "Testing Wallet options", and the self-test all use it.

A config the wallet can't read (not base64url, not JSON, or not the fields
above) shows an error on the approval screen saying why, and the wallet answers
with normal settings.

GitHub Pages can't route paths, so the connectathon site's `404.html` is a copy
of this page with a `<base>` at `testing-wallet/`: the page arrives with HTTP
status 404, and works like the plain page. Any other missing address goes to a
"not found" page.

### Examples

| Options | JSON | URL |
| --- | --- | --- |
| Bad issuer signature | `{"faults":["bad-signature"]}` | <https://smart-health-checkin.org/connectathon/testing-wallet/eyJmYXVsdHMiOlsiYmFkLXNpZ25hdHVyZSJdfQ/> |
| Bad encryption | `{"faults":["bad-encryption"]}` | <https://smart-health-checkin.org/connectathon/testing-wallet/eyJmYXVsdHMiOlsiYmFkLWVuY3J5cHRpb24iXX0/> |
| Wrong request id | `{"faults":["wrong-request-id"]}` | <https://smart-health-checkin.org/connectathon/testing-wallet/eyJmYXVsdHMiOlsid3JvbmctcmVxdWVzdC1pZCJdfQ/> |
| 5 MB response | `{"size":"5m"}` | <https://smart-health-checkin.org/connectathon/testing-wallet/eyJzaXplIjoiNW0ifQ/> |
| Missing status, immunizations declined | `{"faults":["missing-status"],"status":{"immunizations":"declined"}}` | <https://smart-health-checkin.org/connectathon/testing-wallet/eyJmYXVsdHMiOlsibWlzc2luZy1zdGF0dXMiXSwic3RhdHVzIjp7ImltbXVuaXphdGlvbnMiOiJkZWNsaW5lZCJ9fQ/> |

## Limitations

- No Android build. The reference Android wallet covers native testing.
