# SMART Testing Wallet: features and behavior

The SMART Testing Wallet, served at
<https://smart-health-checkin.org/connectathon/testing-wallet/> and listed in
the connectathon wallet registry. It behaves like a real wallet by default. A testing panel adds controls for exercising EHR error handling.

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
  testing EHR and the reference EHR.

## Request handling

- Picks the `org-iso-mdoc` entry from `credentialRequestOptions.digital.requests`
  and parses the `DeviceRequest` and `encryptionInfo` with the client library.
- Validates the SMART request (spec §5). If it's malformed, shows the problem
  and replies `error` with the validator's message.
- Unknown selector kinds make that item `unsupported`. The other items are
  still answered (§5.4.3).

## Patients

- Two synthetic patients from `data/`, chosen at the top of the consent screen:
  - **Aria Test**, 22 KB: demographics, three problems, two allergies, three
    medications, three immunizations, lab and vital signs, and insurance.
  - **Aria Test, large record**, over 2 MB: the same, plus eight years of labs,
    blood pressures, and progress notes. Used for scenario L2.
- Every resource claims its US Core profile. Patient, Coverage, and the payer
  also claim the CARIN digital insurance card profiles. Both files validate
  with the latest HL7 validator (`scripts/validate-fhir.sh`).

## Matching (§5.4.1, §5.5)

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

## Forms (§5.4.2)

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
- Prefill (O10): an item carrying a LOINC code the record has an Observation
  for starts filled in and marked as prefilled.

## Consent

- One card per item: title, summary, and what would be shared, counted by
  resource type. A share/don't-share switch, defaulting to share.
- `required: true` is shown as "the clinic says this is required" and changes
  nothing else.
- Items the patient switches off become `declined`.
- "Decline all" answers with every item `declined` and no artifacts
  ([HOLD-4](https://smart-health-checkin.org/spec/#HOLD-4)). Closing the tab
  without answering is the cancel path: the EHR's call fails.

## Response (§6)

- Exactly one status per item.
- Only media types the item accepts
  ([ACC-2](https://smart-health-checkin.org/spec/#ACC-2)). Selection items use
  the earliest type in `accept` this wallet can produce
  ([ACC-3](https://smart-health-checkin.org/spec/#ACC-3)): one
  `application/fhir+json` Bundle per item, or a SMART Health Card. An item that
  accepts neither type, or a form that doesn't accept `application/fhir+json`,
  is answered `unsupported`.
- Form items become one QuestionnaireResponse.
- One artifact for several items (O7), on the testing panel: allergies and
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

Collapsed by default. Settings persist in the URL fragment, so a test case can
open the wallet preconfigured, for example
`#patient=large&faults=wrong-canonical,missing-status`.

- Force a status per item: fulfilled, partial, unavailable, declined,
  unsupported, or error.
- Faults, each with how an EHR that follows the spec reacts
  ([§6.4](https://smart-health-checkin.org/spec/#6-4-verifier-cross-validation),
  [§8.5](https://smart-health-checkin.org/spec/#8-5-hpke-encryption-and-verifier-processing)):

  | Fault | What it does | The EHR |
  | --- | --- | --- |
  | `wrong-canonical` | QuestionnaireResponse.questionnaire doesn't match the request | sets that record aside ([XV-10](https://smart-health-checkin.org/spec/#XV-10)) |
  | `missing-status` | one item has no status | treats that item as unknown ([XV-3](https://smart-health-checkin.org/spec/#XV-3)) |
  | `duplicate-status` | one item has two statuses | treats that item as unknown ([XV-3](https://smart-health-checkin.org/spec/#XV-3)) |
  | `wrong-request-id` | requestId doesn't match | rejects the response ([XV-2](https://smart-health-checkin.org/spec/#XV-2)) |
  | `unaccepted-media-type` | a record in a type the item didn't accept | sets that record aside ([XV-7](https://smart-health-checkin.org/spec/#XV-7)) |
  | `oversized` | pads the response past 3 MB | passes |
  | `bad-signature` | corrupts the issuer signature | warns and continues ([VRS-5](https://smart-health-checkin.org/spec/#VRS-5)) |
  | `bad-encryption` | corrupts the HPKE ciphertext | rejects the response ([VRS-3](https://smart-health-checkin.org/spec/#VRS-3)) |
  | `wrong-origin` | binds the transcript to the origin with a trailing slash | rejects the response ([VRS-3](https://smart-health-checkin.org/spec/#VRS-3)) |
  | `bad-shc-signature` | a SMART Health Card with a broken signature | sets that card aside ([XV-13](https://smart-health-checkin.org/spec/#XV-13)) |
  | `combine-allergies-meds` | allergies and medications share one Bundle (O7) | passes |
- Shows the parsed request, and the SMART response as sent.

## Limitations in this version

- No Android build. The reference Android wallet covers native testing.
