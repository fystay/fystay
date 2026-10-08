import { describe, expect, it } from "vitest";
import { createOAuthTwoFactorToken, verifyOAuthTwoFactorToken } from "./oauthTwoFactor";

describe("Google/Apple two-factor step token", () => {
  const now = new Date("2026-10-08T10:00:00Z");

  it("names the account Google/Apple vouched for, for five minutes", () => {
    const token = createOAuthTwoFactorToken("user_1", "secret", now);
    expect(verifyOAuthTwoFactorToken(token, "secret", new Date(now.getTime() + 4 * 60_000))).toBe("user_1");
    expect(verifyOAuthTwoFactorToken(token, "secret", new Date(now.getTime() + 6 * 60_000))).toBeNull();
  });

  it("can't be forged or edited", () => {
    const token = createOAuthTwoFactorToken("user_1", "secret", now);
    expect(verifyOAuthTwoFactorToken(token, "another-secret", now)).toBeNull();
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "admin", purpose: "oauth-2fa", exp: 9e9 })).toString("base64url");
    expect(verifyOAuthTwoFactorToken(`${forged}.${signature}`, "secret", now)).toBeNull();
    expect(verifyOAuthTwoFactorToken(undefined, "secret", now)).toBeNull();
  });
});
