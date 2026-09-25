// Sealing the SMART response for the EHR (spec §8.4, §8.5), with optional wire faults.
import {
  buildDcapiSessionTranscript,
  buildSignedDeviceResponse,
  recipientJwkFromEncryptionInfo,
  type SmartCheckinResponse,
} from "@smart-health-checkin/client";
import { buildDcapiMdocResponse, cborDecode, cborEncode, hpkeSealDirectMdoc, mapGet } from "@smart-health-checkin/client/wire";

export type WireFault = "bad-signature" | "bad-encryption" | "wrong-origin";

export async function seal(input: {
  smartResponse: SmartCheckinResponse;
  encryptionInfoBytes: Uint8Array;
  ehrOrigin: string;
  faults: Set<string>;
}): Promise<{ protocol: string; data: { response: string } }> {
  const origin = input.faults.has("wrong-origin") ? "https://not-the-requester.example" : input.ehrOrigin;
  const sessionTranscript = await buildDcapiSessionTranscript({ origin, encryptionInfo: input.encryptionInfoBytes });
  let deviceResponse = await buildSignedDeviceResponse({
    smartResponseJson: JSON.stringify(input.smartResponse),
    sessionTranscript,
  });
  if (input.faults.has("bad-signature")) deviceResponse = corruptIssuerSignature(deviceResponse);
  const sealed = await hpkeSealDirectMdoc({
    plaintext: deviceResponse,
    recipientPublicJwk: recipientJwkFromEncryptionInfo(input.encryptionInfoBytes),
    info: sessionTranscript,
  });
  if (input.faults.has("bad-encryption")) {
    const cipherText = new Uint8Array(sealed.cipherText);
    cipherText[cipherText.length - 1] ^= 0xff;
    return buildDcapiMdocResponse({ enc: sealed.enc, cipherText });
  }
  return sealed.response;
}

/** Flip a byte in documents[0].issuerSigned.issuerAuth's signature. */
function corruptIssuerSignature(deviceResponseBytes: Uint8Array): Uint8Array {
  const decoded = cborDecode(deviceResponseBytes);
  const documents = mapGet(decoded, "documents");
  const issuerSigned = mapGet(Array.isArray(documents) ? documents[0] : undefined, "issuerSigned");
  const issuerAuth = mapGet(issuerSigned, "issuerAuth");
  if (!Array.isArray(issuerAuth) || !(issuerAuth[3] instanceof Uint8Array)) throw new Error("could not find issuerAuth signature to corrupt");
  issuerAuth[3][0] ^= 0xff;
  return cborEncode(decoded);
}
