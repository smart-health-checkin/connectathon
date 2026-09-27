# Sample responses

The decrypted SMART Health Check-in response ([spec §6](https://smart-health-checkin.org/spec/#6-clinical-response-model)) that the SMART Testing Wallet sends for the requests of the [minimum scenarios](https://smart-health-checkin.org/connectathon/scenarios.html#minimum-scenarios), when the patient shares everything. Use them to build and test your EHR's parsing and display without running a wallet.

These are the JSON inside the mdoc response, after decryption and signature checks. To test the full exchange, use the [Testing Wallet](../testing-wallet/).

| File | Request |
|---|---|
| `records.sample.json` | `records.json`: demographics, problems, allergies, medications, and immunizations |
| `insurance.sample.json` | `insurance.json`: demographics and insurance |
| `form-phq2.sample.json` | `form-phq2.json`: demographics and the PHQ-2, answered "Several days" twice |
