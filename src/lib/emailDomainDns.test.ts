import { describe, expect, it } from "vitest";
import { checkEmailDomain, emailDnsCheckEnabled } from "./emailDomainDns";

const err = (code: string) => Object.assign(new Error(code), { code });
const resolver = (answers: { mx?: unknown; a?: unknown; aaaa?: unknown }) => {
  const answer = (value: unknown) => async () => {
    if (value instanceof Error) throw value;
    return (value ?? []) as never[];
  };
  return { resolveMx: answer(answers.mx), resolve4: answer(answers.a), resolve6: answer(answers.aaaa) } as never;
};

describe("checkEmailDomain (DNS stubbed - no real lookups)", () => {
  it("is ok with MX records", async () => {
    expect(await checkEmailDomain("example.com", resolver({ mx: [{ exchange: "mx.example.com", priority: 10 }] }))).toBe("ok");
  });

  it("is ok with no MX but an address record mail can fall back to", async () => {
    expect(await checkEmailDomain("example.com", resolver({ mx: err("ENODATA"), a: ["192.0.2.1"] }))).toBe("ok");
  });

  it("says the domain doesn't exist (e.g. fystay.couk)", async () => {
    expect(await checkEmailDomain("fystay.couk", resolver({ mx: err("ENOTFOUND") }))).toBe("no_domain");
  });

  it("says a domain with nowhere to deliver mail doesn't take email", async () => {
    expect(await checkEmailDomain("example.com", resolver({ mx: err("ENODATA"), a: err("ENODATA"), aaaa: err("ENODATA") }))).toBe("no_mail");
  });

  it("never fails someone because DNS couldn't answer", async () => {
    expect(await checkEmailDomain("example.com", resolver({ mx: err("ETIMEOUT") }))).toBe("unknown");
    expect(await checkEmailDomain("example.com", resolver({ mx: err("ENODATA"), a: err("ESERVFAIL"), aaaa: err("ENODATA") }))).toBe("unknown");
  });
});

describe("emailDnsCheckEnabled", () => {
  it("runs on deployed sites only, unless overridden", () => {
    expect(emailDnsCheckEnabled({ VERCEL: "1" })).toBe(true);
    expect(emailDnsCheckEnabled({})).toBe(false);
    expect(emailDnsCheckEnabled({ VERCEL: "1", EMAIL_DNS_CHECK: "off" })).toBe(false);
    expect(emailDnsCheckEnabled({ EMAIL_DNS_CHECK: "on" })).toBe(true);
  });
});
