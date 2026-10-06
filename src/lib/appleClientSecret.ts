import { createPrivateKey, sign } from "crypto";

/**
 * Apple doesn't issue a fixed client secret. It's a short JWT you sign
 * yourself with a private key from Apple Developer (Keys -> Sign in with
 * Apple), valid for at most six months. Generating it here from the key
 * means nobody has to remember to re-make it twice a year; the key itself
 * never leaves the server (APPLE_PRIVATE_KEY is a server-only variable).
 *
 * https://developer.apple.com/documentation/accountorganizationaldatasharing/creating-a-client-secret
 */

/** Apple's ceiling is 15777000 seconds (six months); stay well inside it. */
export const APPLE_CLIENT_SECRET_TTL_SECONDS = 60 * 60 * 24 * 150;

export type AppleClientSecretInput = {
  /** The Services ID (e.g. "uk.co.fystay.web"), which is the OAuth client id. */
  clientId: string;
  teamId: string;
  keyId: string;
  /** The .p8 file's contents. Literal "\n" sequences (as some dashboards store them) are accepted. */
  privateKey: string;
  now?: Date;
};

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function createAppleClientSecret({ clientId, teamId, keyId, privateKey, now = new Date() }: AppleClientSecretInput): string {
  const key = createPrivateKey(privateKey.replace(/\\n/g, "\n").trim());
  const iat = Math.floor(now.getTime() / 1000);
  const signingInput = `${base64url({ alg: "ES256", kid: keyId })}.${base64url({
    iss: teamId,
    iat,
    exp: iat + APPLE_CLIENT_SECRET_TTL_SECONDS,
    aud: "https://appleid.apple.com",
    sub: clientId,
  })}`;
  // JWS ES256 wants the raw 64-byte r||s signature, not DER.
  const signature = sign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${signature.toString("base64url")}`;
}
