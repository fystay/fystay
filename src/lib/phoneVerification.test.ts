import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PhoneVerificationError,
  checkVerificationCode,
  isPhoneVerificationConfigured,
  isValidE164Phone,
  normalizePhoneInput,
  phoneRateLimitKey,
  sendVerificationCode,
} from "./phoneVerification";

describe("isValidE164Phone", () => {
  it("accepts a plausible UK mobile number in E.164 form", () => {
    expect(isValidE164Phone("+447911123456")).toBe(true);
  });

  it("accepts a plausible US number in E.164 form", () => {
    expect(isValidE164Phone("+14155552671")).toBe(true);
  });

  it("rejects a number missing the leading +", () => {
    expect(isValidE164Phone("447911123456")).toBe(false);
  });

  it("rejects a number starting with 0 after the +", () => {
    expect(isValidE164Phone("+0447911123456")).toBe(false);
  });

  it("rejects a number that's too short", () => {
    expect(isValidE164Phone("+4479")).toBe(false);
  });

  it("rejects a number with letters or spaces", () => {
    expect(isValidE164Phone("+44 7911 123456")).toBe(false);
    expect(isValidE164Phone("+44791112345a")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isValidE164Phone("")).toBe(false);
  });
});

describe("normalizePhoneInput", () => {
  it("reads a UK number typed with a leading 0 and spaces", () => {
    expect(normalizePhoneInput("07911 123456")).toBe("+447911123456");
  });

  it("accepts international numbers typed with spaces, dashes or a 00 prefix", () => {
    expect(normalizePhoneInput("+33 6 12-34-56-78")).toBe("+33612345678");
    expect(normalizePhoneInput("0033 6 12 34 56 78")).toBe("+33612345678");
  });

  it("rejects text that isn't a phone number", () => {
    expect(normalizePhoneInput("call me")).toBeNull();
    expect(normalizePhoneInput("0791")).toBeNull();
  });
});

describe("phoneRateLimitKey", () => {
  it("never contains the number itself", () => {
    const key = phoneRateLimitKey("+447911123456");
    expect(key).not.toContain("7911123456");
    expect(key).toBe(phoneRateLimitKey("+447911123456"));
  });
});

describe("Twilio Verify calls", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC_test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token_test");
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "VA_test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

  it("is unavailable without all three Twilio settings", async () => {
    vi.stubEnv("TWILIO_VERIFY_SERVICE_SID", "");
    expect(isPhoneVerificationConfigured()).toBe(false);
    await expect(sendVerificationCode("+447911123456")).rejects.toMatchObject({ status: 501 });
    expect(await checkVerificationCode("+447911123456", "123456")).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps Twilio send errors to safe messages without echoing Twilio's text", async () => {
    fetchMock.mockResolvedValueOnce(reply(429, { code: 60203, message: "Max send attempts reached for +447911123456" }));
    const error = await sendVerificationCode("+447911123456").catch((e) => e);
    expect(error).toBeInstanceOf(PhoneVerificationError);
    expect(error.status).toBe(429);
    expect(error.message).not.toContain("7911123456");

    fetchMock.mockResolvedValueOnce(reply(400, { code: 60200 }));
    await expect(sendVerificationCode("+447911123456")).rejects.toMatchObject({ status: 400 });

    fetchMock.mockRejectedValueOnce(new Error("network down"));
    await expect(sendVerificationCode("+447911123456")).rejects.toMatchObject({ status: 502 });
  });

  it("approves only when Twilio says approved", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, { status: "approved" }));
    expect(await checkVerificationCode("+447911123456", "123456")).toBe("approved");
    fetchMock.mockResolvedValueOnce(reply(200, { status: "pending" }));
    expect(await checkVerificationCode("+447911123456", "000000")).toBe("incorrect");
    fetchMock.mockResolvedValueOnce(reply(404, { code: 20404 }));
    expect(await checkVerificationCode("+447911123456", "123456")).toBe("expired");
    fetchMock.mockResolvedValueOnce(reply(429, { code: 60202 }));
    expect(await checkVerificationCode("+447911123456", "123456")).toBe("too_many_attempts");
    fetchMock.mockRejectedValueOnce(new Error("timeout"));
    expect(await checkVerificationCode("+447911123456", "123456")).toBe("unavailable");
  });
});
