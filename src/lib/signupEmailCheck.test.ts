import { describe, expect, it, vi } from "vitest";
import { checkNewEmail } from "./signupEmailCheck";

describe("checkNewEmail", () => {
  it("rejects a malformed address before anything else", async () => {
    expect(await checkNewEmail("not-an-email", { dnsEnabled: false })).toMatchObject({ ok: false, status: 400 });
  });

  it("asks about a likely typo, and never rewrites it", async () => {
    expect(await checkNewEmail("hello@fystay.couk", { dnsEnabled: false })).toEqual({
      ok: false,
      status: 422,
      error: "Did you mean hello@fystay.co.uk?",
      suggestion: "hello@fystay.co.uk",
    });
  });

  it("accepts an address kept as typed once the person has seen the suggestion - unless its domain can't take mail", async () => {
    expect(await checkNewEmail("sam@gmial.com", { acceptedAsTyped: true, dnsEnabled: false })).toEqual({ ok: true });
    const checkDomain = vi.fn(async () => "no_domain" as const);
    expect(await checkNewEmail("hello@fystay.couk", { acceptedAsTyped: true, dnsEnabled: true, checkDomain })).toMatchObject({
      ok: false,
      status: 400,
    });
    expect(checkDomain).toHaveBeenCalledWith("fystay.couk");
  });

  it("blocks a domain that publishes nowhere to deliver mail", async () => {
    const result = await checkNewEmail("sam@parked.example", { dnsEnabled: true, checkDomain: async () => "no_mail" });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("lets an unfamiliar real domain through, and never blocks on a DNS hiccup", async () => {
    expect(await checkNewEmail("sam@smallbusiness.org", { dnsEnabled: true, checkDomain: async () => "ok" })).toEqual({ ok: true });
    expect(await checkNewEmail("sam@smallbusiness.org", { dnsEnabled: true, checkDomain: async () => "unknown" })).toEqual({ ok: true });
  });

  it("skips the DNS lookup where it's off (local, CI)", async () => {
    const checkDomain = vi.fn();
    expect(await checkNewEmail("sam@made-up.test", { dnsEnabled: false, checkDomain })).toEqual({ ok: true });
    expect(checkDomain).not.toHaveBeenCalled();
  });
});
