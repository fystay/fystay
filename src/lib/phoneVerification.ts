import { createHash } from "node:crypto";

const TWILIO_VERIFY_BASE = "https://verify.twilio.com/v2";
const REQUEST_TIMEOUT_MS = 10000;

/** Twilio Verify's default code lifetime (set on the Verify service). */
export const CODE_TTL_SECONDS = 10 * 60;
/** How long the person waits before "Resend code" is allowed again. */
export const RESEND_COOLDOWN_SECONDS = 30;

/**
 * Phone verification via Twilio Verify's REST API - a plain fetch client,
 * not the twilio npm SDK, the same "no extra dependency for one small API"
 * approach as the Ticketmaster/Overpass/Open-Meteo integrations in
 * src/lib/localData/. Genuinely needs a paid Twilio account (unlike those
 * three), so it's inactive without TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
 * and TWILIO_VERIFY_SERVICE_SID all set - see isPhoneVerificationConfigured,
 * checked by both the API routes and the /account page before this is ever
 * called, the same "plumbing, inactive without key" pattern as
 * TICKETMASTER_API_KEY.
 *
 * Twilio generates, sends, stores and expires the code, so FYStay never
 * sees or logs it; the API routes only pass the guess through.
 */
function twilioCredentials(): { accountSid: string; authToken: string; serviceSid: string } | null {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

export function isPhoneVerificationConfigured(): boolean {
  return twilioCredentials() !== null;
}

function basicAuthHeader(accountSid: string, authToken: string): string {
  return `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`;
}

/**
 * A pragmatic E.164 check (leading +, 8-15 digits) - loose enough not to
 * reject real international numbers, strict enough to fail fast on an
 * obviously wrong value before spending a real Twilio API call on it.
 * Twilio itself is still the actual authority on deliverability.
 */
export function isValidE164Phone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Accepts what people actually type - spaces, dashes, brackets, a UK
 * leading 0 - and returns E.164, or null if it can't be. A number starting
 * 0 is read as UK (FYStay's market); other countries need their + code.
 */
export function normalizePhoneInput(input: string): string | null {
  let digits = input.trim().replace(/[\s\-().]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;
  else if (/^0\d{9,10}$/.test(digits)) digits = `+44${digits.slice(1)}`;
  return isValidE164Phone(digits) ? digits : null;
}

/** Rate-limit keys use this, so the RateLimitHit table never stores a raw number. */
export function phoneRateLimitKey(phone: string): string {
  return createHash("sha256").update(phone).digest("hex").slice(0, 32);
}

/** A send failure with a message that's safe to show - never Twilio's own text, which can echo the number. */
export class PhoneVerificationError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "PhoneVerificationError";
  }
}

// Twilio Verify error codes -> what the person can do about it.
function sendErrorFor(code: number | undefined): PhoneVerificationError {
  switch (code) {
    case 60200:
    case 21211:
    case 60205:
      return new PhoneVerificationError("That number can't receive text messages. Check it and try again.", 400);
    case 60203:
      return new PhoneVerificationError("Too many codes sent to this number. Please wait 10 minutes and try again.", 429);
    case 60410:
    case 60605:
    case 60220:
      return new PhoneVerificationError("We can't send codes to that number. Try a different mobile number.", 400);
    default:
      return new PhoneVerificationError("We couldn't send a code just now. Please try again in a few minutes.", 502);
  }
}

export async function sendVerificationCode(phone: string): Promise<void> {
  const creds = twilioCredentials();
  if (!creds) {
    throw new PhoneVerificationError("Phone verification isn't switched on yet.", 501);
  }

  const response = await fetch(
    `${TWILIO_VERIFY_BASE}/Services/${creds.serviceSid}/Verifications`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(creds.accountSid, creds.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Channel: "sms" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => null);

  if (!response) throw sendErrorFor(undefined);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw sendErrorFor(typeof data?.code === "number" ? data.code : undefined);
  }
}

export type CodeCheckResult = "approved" | "incorrect" | "expired" | "too_many_attempts" | "unavailable";

/**
 * Twilio answers a wrong guess with status "pending" (or 60200 for a
 * malformed one); a code that has expired, been used, or never existed
 * with 404 (20404); and too many wrong guesses on one code with 429 (60202).
 */
export async function checkVerificationCode(phone: string, code: string): Promise<CodeCheckResult> {
  const creds = twilioCredentials();
  if (!creds) return "unavailable";

  const response = await fetch(
    `${TWILIO_VERIFY_BASE}/Services/${creds.serviceSid}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        Authorization: basicAuthHeader(creds.accountSid, creds.authToken),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Code: code }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  ).catch(() => null);

  if (!response) return "unavailable";
  if (response.status === 404) return "expired";
  if (response.status === 429) return "too_many_attempts";
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    if (data?.code === 60202) return "too_many_attempts";
    if (data?.code === 20404) return "expired";
    if (data?.code === 60200) return "incorrect";
    return "unavailable";
  }
  const data = await response.json().catch(() => null);
  return data?.status === "approved" ? "approved" : "incorrect";
}
