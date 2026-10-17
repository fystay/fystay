"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Phone } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Field, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

type Sent = { phone: string; expiresAt: number; resendAt: number };

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: res.ok, status: res.status, data: await res.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

function errorText(data: Record<string, unknown> | null, fallback: string): string {
  return typeof data?.error === "string" ? data.error : fallback;
}

/**
 * Phone verification via Twilio Verify (src/lib/phoneVerification.ts).
 * Twilio sends and checks the code; this card only collects the number and
 * the guess. `configured` is whether Twilio is set up at all, decided
 * server-side.
 */
export function PhoneVerificationCard({
  verifiedPhone,
  configured,
}: {
  verifiedPhone: string | null;
  configured: boolean;
}) {
  const router = useRouter();
  const [changing, setChanging] = useState(false);
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sent) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sent]);

  const resendIn = sent ? Math.max(0, Math.ceil((sent.resendAt - now) / 1000)) : 0;
  const expired = sent ? now >= sent.expiresAt : false;

  async function sendCode(target: string) {
    setSending(true);
    setError(null);
    const { ok, status, data } = await postJson("/api/account/phone/send-code", { phone: target });
    setSending(false);
    if (!ok) {
      setError(
        status === 429
          ? errorText(data, "Too many attempts.") + " Please wait a little before trying again."
          : errorText(data, "Could not send a verification code. Check your connection and try again."),
      );
      return;
    }
    const at = Date.now();
    setNow(at);
    setSent({
      phone: typeof data?.phone === "string" ? data.phone : target,
      expiresAt: at + Number(data?.expiresInSeconds ?? 600) * 1000,
      resendAt: at + Number(data?.resendInSeconds ?? 30) * 1000,
    });
    setCode("");
    toast.success("Code sent - check your text messages.");
  }

  async function verifyCode() {
    if (!sent) return;
    setVerifying(true);
    setError(null);
    const { ok, data } = await postJson("/api/account/phone/verify-code", { phone: sent.phone, code: code.trim() });
    setVerifying(false);
    if (!ok) {
      setError(errorText(data, "Could not check that code. Please try again."));
      if (data?.reason === "expired" || data?.reason === "too_many_attempts") setCode("");
      return;
    }
    toast.success("Phone number verified");
    setSent(null);
    setCode("");
    setChanging(false);
    router.refresh();
  }

  function startOver() {
    setSent(null);
    setCode("");
    setError(null);
  }

  const showForm = configured && (!verifiedPhone || changing);

  return (
    <Card className="p-5" id="phone-verification">
      <CardHeader className="flex flex-row items-center justify-between gap-3 p-0">
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-4.5 w-4.5 text-stone-400" aria-hidden />
          Phone verification
        </CardTitle>
        <Badge variant={verifiedPhone ? "success" : sent ? "warning" : "neutral"}>
          {verifiedPhone ? "Verified" : sent ? "Code sent" : "Not verified"}
        </Badge>
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-3 p-0 text-sm text-stone-600">
        {verifiedPhone && !changing && (
          // A past verification stays true regardless of whether Twilio
          // happens to be configured in this environment right now - only
          // verifying a NEW number needs `configured`.
          <>
            <p className="flex items-center gap-1.5 text-foreground">
              <BadgeCheck className="h-4 w-4 shrink-0 text-brand-600" aria-hidden />
              {verifiedPhone}
            </p>
            {configured && (
              <Button variant="outline" size="sm" className="self-start" onClick={() => setChanging(true)}>
                Use a different number
              </Button>
            )}
          </>
        )}

        {!configured && !verifiedPhone && (
          <p>
            Phone verification isn&apos;t switched on yet, so there&apos;s nothing to do here for now. Your number
            shows as not verified until you confirm it with a code.
          </p>
        )}

        {showForm && !sent && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (phone.trim()) void sendCode(phone);
            }}
          >
            <p>We&apos;ll text you a 6-digit code to confirm the number is yours.</p>
            <Field>
              <Label htmlFor="phone">Mobile number</Label>
              <div className="flex gap-2">
                <Input
                  id="phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="07911 123456"
                  aria-describedby="phoneHint"
                  aria-invalid={Boolean(error) || undefined}
                />
                <Button type="submit" loading={sending} disabled={!phone.trim()}>
                  Send code
                </Button>
              </div>
              <p id="phoneHint" className="mt-1.5 text-xs text-stone-500">
                UK numbers can start with 0. Others need their country code, e.g. +33.
              </p>
            </Field>
            {changing && (
              <Button type="button" variant="ghost" size="sm" className="self-start" onClick={() => setChanging(false)}>
                Cancel
              </Button>
            )}
          </form>
        )}

        {showForm && sent && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void verifyCode();
            }}
          >
            <p>
              We sent a code to <span className="font-medium text-foreground">{sent.phone}</span>.{" "}
              {expired ? "It has expired - send a new one." : "It expires in 10 minutes."}
            </p>
            <Field>
              <Label htmlFor="verificationCode">Verification code</Label>
              <div className="flex gap-2">
                <Input
                  id="verificationCode"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={10}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="123456"
                  aria-invalid={Boolean(error) || undefined}
                />
                <Button type="submit" loading={verifying} disabled={code.trim().length < 4 || expired}>
                  Verify
                </Button>
              </div>
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={sending}
                disabled={resendIn > 0}
                onClick={() => void sendCode(sent.phone)}
              >
                {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={startOver}>
                Change number
              </Button>
            </div>
          </form>
        )}

        {error && (
          <p role="alert" className="text-red-700">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
