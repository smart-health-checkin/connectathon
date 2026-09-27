# Test requests

Every request used by the [test scenarios](../scenarios.html#minimum-scenarios) and [advanced scenarios](../advanced.html), as SMART Health Check-in request JSON ([spec §5.2](https://smart-health-checkin.org/spec/#5-2-normative-typescript-model)).

Each file's `id` is `replace-with-a-unique-id`. Your EHR must send a fresh, unique `id` with every request, and the wallet echoes it back as `requestId`.

"Try in the clinic check-in demo" opens the client library's clinic check-in demo with that request and the event wallet registry loaded.

`unknown-selector.json` ([O12](../advanced.html#o12)) carries an extension selector kind that no wallet will recognize, on purpose. A wallet should answer that item `unsupported` and still answer the others ([§5.4.3](https://smart-health-checkin.org/spec/#5-4-3-extension-selectors)).
