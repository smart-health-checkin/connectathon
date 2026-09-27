# Advanced scenarios

These scenarios are for teams that have passed the [minimum scenarios](./#minimum-scenarios). None is required. Each has the same parts as a minimum scenario, the [ground rules](./#ground-rules) apply except that responses can be any size, and runs are recorded the same way ([Recording results](./#recording-results)).

## Larger data scenarios

These test that a large response arrives intact, from the wallet through the browser to the Verifier.

<!-- test cases: advanced larger-data -->

## Optional scenarios

These exercise parts of the spec that the minimum scenarios leave out: forms and selectors beyond the basics, SMART Health Cards, other ways of reaching the check-in page, and a patient who declines every item. Some need a feature that few wallets have yet, such as answering two items with one record ([shared-artifact](#shared-artifact)), which the SMART Testing Wallet can do on request.

<!-- test cases: advanced -->

## Example questionnaires

There is no single intake form for this event. These forms give Verifiers something realistic to send and wallets something realistic to render. Each is hosted as a FHIR Questionnaire whose `url` is its address, so a wallet can also fetch it by reference ([§5.4.2](https://smart-health-checkin.org/spec/#5-4-2-form-fhir)).

| Form | Kind | Used in |
|---|---|---|
| [PHQ-2 depression screen](Questionnaire/phq-2.json), 2 questions | Standard screening instrument | [fill-form](./#fill-form), [versioned-canonical](#versioned-canonical) |
| [GAD-7 anxiety screen](Questionnaire/gad-7.json), 7 questions | Standard screening instrument | [form-by-reference](#form-by-reference) |
| [Semaglutide 4-week check-in](Questionnaire/semaglutide-4-week-checkin.json), 13 questions | Written by a physician for patients starting this one medication | [physician-form](#physician-form), [prefilled-form](#prefilled-form) |

The semaglutide form asks only what the patient's record can't answer: how the weekly shots are going, missed doses, pen problems, nausea and other side effects, warning symptoms, and readiness to step up the dose. It uses integer, yes/no, single-choice, check-all-that-apply, and free-text items. One question accepts both checked options and the patient's own words. Two items appear only when an earlier answer calls for them. No item is required.

## Testing EHR and Testing Wallet

Beyond running a scenario, both test tools can send and answer things of your choosing.

- **[SMART Testing EHR](testing-ehr/)**
  - "What to send" chooses the request: any scenario's request, one you build from their items, or one you paste. The request is all that goes to the wallet.
  - "Which wallet" sends to any registry wallet, any web wallet by URL, or the phone's own wallet. The EHR opens each wallet at the URL it's given and judges every response the same way.
  - It checks the response against the spec, each check linked to its requirement. The verdict says whether the response was rejected, usable with problems in some items or records, or passed, possibly with warnings. As the spec says for receivers, problems in the mdoc layer (signatures, digests, validity dates) are warnings, not failures.
- **[SMART Testing Wallet](testing-wallet/)**
  - Answers with a choice of patient, statuses, and artifact shapes, and reports any problems with the incoming request against [§5](https://smart-health-checkin.org/spec/#5-clinical-request-model).
  - Can send deliberately broken or very large responses, so Verifiers can test their error handling: a wrong canonical echo, a missing status, an unaccepted media type, a bad signature, a 5 MB response, and more. Each fault is labeled with how a Verifier that follows the spec reacts: reject the response, set one record aside, treat one item as unknown, or warn. The full list is on its [features page](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#testing-panel).
  - To test your own Verifier with these options, open the wallet, set them in its testing panel, choose "Copy wallet URL for these settings", and add that URL as a web wallet on your page. From the Testing EHR, "Testing Wallet options" does the same. These [config URLs](https://github.com/smart-health-checkin/connectathon/blob/main/testing-wallet/FEATURES.md#config-urls) are the Testing Wallet's own format, not part of SMART Health Check-in.
