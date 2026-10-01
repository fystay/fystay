import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "crypto";

// Same AES-256-GCM shape as src/lib/pms/crypto.ts, kept as its own small
// module (rather than a shared one) so a mistake in one encryption domain's
// key handling can never affect the other - a leaked/rotated
// TWO_FACTOR_ENCRYPTION_KEY has nothing to do with PMS credentials, and
// vice versa.
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const SALT = "fystay-two-factor-secret";

/** Whether 2FA can be offered at all on this deployment - see getKey. */
export function isTwoFactorConfigured(): boolean {
  return Boolean(process.env.TWO_FACTOR_ENCRYPTION_KEY);
}

function getKey(): Buffer {
  const secret = process.env.TWO_FACTOR_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "TWO_FACTOR_ENCRYPTION_KEY is not set - required to store or read a user's 2FA secret. See .env.example.",
    );
  }
  return scryptSync(secret, SALT, 32);
}

/** Encrypts a TOTP secret for storage in User.twoFactorSecretCiphertext - never stored or logged in plaintext. */
export function encryptTwoFactorSecret(secret: string): string {
  const key = getKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), encrypted.toString("base64")].join(".");
}

/** Reverses encryptTwoFactorSecret. Throws on a malformed/tampered ciphertext rather than returning garbage a TOTP check would then run against. */
export function decryptTwoFactorSecret(ciphertext: string): string {
  const key = getKey();
  const [ivB64, authTagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Malformed two-factor secret ciphertext");
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(authTagB64, "base64"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
  return decrypted.toString("utf8");
}
