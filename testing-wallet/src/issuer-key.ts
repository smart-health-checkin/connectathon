// Test issuer key for SMART Health Cards minted by the reference wallet.
// This private key is public on purpose: the issuer exists only for testing,
// and anyone may mint cards with it. Never trust this issuer for real data.
export const ISSUER = "https://smart-health-checkin.org/connectathon/testing-wallet/issuer";
export const ISSUER_PRIVATE_JWK: JsonWebKey & { kid: string } = {"crv":"P-256","d":"kbu08zkcUbtePuzYXnDzW8x2SdRZiQS9iuaG7IRX0Wo","ext":true,"key_ops":["sign"],"kty":"EC","x":"Y7H-yUmse1E8pfl-oTNOtdWoKTJD1TirTyhn5BauoBU","y":"Siso_LBP2ttS07a6kRDtXwYbTC3UM_YQbCKJhE2qU1E","kid":"T8so9DbszgV8Y5E1_KcYtN8mScyJYAcINo_QTKT8M0g","alg":"ES256"};
export const ISSUER_KID = "T8so9DbszgV8Y5E1_KcYtN8mScyJYAcINo_QTKT8M0g";
