import { generateKeyPairSync, verify } from "crypto";
import { describe, expect, it } from "vitest";
import { APPLE_CLIENT_SECRET_TTL_SECONDS, createAppleClientSecret } from "./appleClientSecret";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("createAppleClientSecret", () => {
  const now = new Date("2026-10-07T09:00:00Z");
  const input = { clientId: "uk.co.fystay.web", teamId: "TEAM123456", keyId: "KEY1234567", privateKey: pem, now };

  it("makes an ES256 JWT with the claims Apple requires", () => {
    const [header, payload] = createAppleClientSecret(input).split(".");
    expect(decode(header)).toEqual({ alg: "ES256", kid: "KEY1234567" });
    const iat = Math.floor(now.getTime() / 1000);
    expect(decode(payload)).toEqual({
      iss: "TEAM123456",
      iat,
      exp: iat + APPLE_CLIENT_SECRET_TTL_SECONDS,
      aud: "https://appleid.apple.com",
      sub: "uk.co.fystay.web",
    });
    expect(APPLE_CLIENT_SECRET_TTL_SECONDS).toBeLessThan(15777000);
  });

  it("is signed by the private key, in JWS (raw r||s) form", () => {
    const [header, payload, signature] = createAppleClientSecret(input).split(".");
    const sig = Buffer.from(signature, "base64url");
    expect(sig).toHaveLength(64);
    expect(
      verify("sha256", Buffer.from(`${header}.${payload}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, sig),
    ).toBe(true);
  });

  it("accepts a key stored with literal \\n sequences", () => {
    const oneLine = pem.replace(/\n/g, "\\n");
    expect(createAppleClientSecret({ ...input, privateKey: oneLine }).split(".")).toHaveLength(3);
  });
});
