# SMART reference web wallet: features and behavior

The single reference web wallet for SMART Health Check-in, served at
<https://smart-health-checkin.org/connectathon/testing-wallet/> and listed in
the connectathon wallet registry. It replaces the client library's demo wallet
and the spec repo's unfinished `rp-web` wallet. It behaves like a real wallet by
default. A testing panel adds controls for exercising EHR error handling.

## Hand-off

- Implements the [web wallet hand-off](../web-wallet-handoff.md): post `ready` to
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
- Classifies `readerAuth` as absent or present. Verifying its signature is
  listed under limitations.
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
- "Not now" replies `declined` for the whole request.

## Response (§6)

- Exactly one status per item.
- Selection items become one `application/fhir+json` Bundle per item, or a
  SMART Health Card when the item lists `application/smart-health-card` first
  in `accept`.
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
- Faults:
  - `wrong-canonical`: QuestionnaireResponse.questionnaire drops the version or changes the URL
  - `missing-status`: one item has no status
  - `duplicate-status`: one item has two statuses
  - `wrong-request-id`: requestId doesn't match
  - `unaccepted-media-type`: an artifact in a type the item didn't accept
  - `oversized`: pads the response past 3 MB
  - `bad-signature`: corrupts the issuer signature
  - `bad-encryption`: corrupts the HPKE ciphertext
  - `wrong-origin`: binds the transcript to a different origin
  - `bad-shc-signature`: a SMART Health Card with a broken signature
- Shows the parsed request, and the SMART response as sent.

## Limitations in this version

- `readerAuth` is detected but its signature isn't verified.
- No Android build. The reference Android wallet covers native testing.
