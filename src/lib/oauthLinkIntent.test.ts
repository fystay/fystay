import { describe, expect, it } from "vitest";
import { createLinkIntent, LINK_INTENT_TTL_SECONDS, verifyLinkIntent } from "./oauthLinkIntent";

const SECRET = "test-secret";
const now = new Date("2026-10-07T09:00:00Z");

describe("link intent", () => {
  it("round-trips for the same provider", () => {
    const token = createLinkIntent("user_1", "google", SECRET, now);
    expect(verifyLinkIntent(token, "google", SECRET, now)).toBe("user_1");
  });

  it("refuses another provider, another secret, or a missing token", () => {
    const token = createLinkIntent("user_1", "google", SECRET, now);
    expect(verifyLinkIntent(token, "apple", SECRET, now)).toBeNull();
    expect(verifyLinkIntent(token, "google", "other-secret", now)).toBeNull();
    expect(verifyLinkIntent(undefined, "google", SECRET, now)).toBeNull();
  });

  it("expires", () => {
    const token = createLinkIntent("user_1", "apple", SECRET, now);
    const later = new Date(now.getTime() + LINK_INTENT_TTL_SECONDS * 1000);
    expect(verifyLinkIntent(token, "apple", SECRET, later)).toBeNull();
  });

  it("refuses a token whose payload was swapped for another user's", () => {
    const token = createLinkIntent("user_1", "google", SECRET, now);
    const [, signature] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ userId: "attacker", provider: "google", exp: 9999999999 })).toString(
      "base64url",
    );
    expect(verifyLinkIntent(`${forged}.${signature}`, "google", SECRET, now)).toBeNull();
    expect(verifyLinkIntent(`${token}.extra`, "google", SECRET, now)).toBeNull();
    expect(verifyLinkIntent("garbage", "google", SECRET, now)).toBeNull();
  });
});
