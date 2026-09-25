# Sample responses

The decrypted SMART Health Check-in response ([spec §6](https://smart-health-checkin.org/spec/#6-clinical-response-model)) that the SMART Testing Wallet sends for Baselines 1 to 3, when the patient shares everything. Use them to build and test your EHR's parsing and display without running a wallet.

These are the JSON inside the mdoc response, after decryption and signature checks. To test the full exchange, use the [testing wallet](../testing-wallet/).

| File | Request |
|---|---|
| `baseline-1.sample.json` | Demographics and PAMI |
| `baseline-2.sample.json` | Demographics and insurance |
| `baseline-3.sample.json` | Demographics and PHQ-2, answered "Several days" twice |
