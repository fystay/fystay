"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MailCheck, MailWarning } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { sanitizeCallbackUrl } from "@/lib/safeRedirect";

const LINK_PROBLEM: Record<string, { title: string; body: string }> = {
  expired: {
    title: "That link has expired",
    body: "Confirmation links work for 48 hours. Enter your email and we'll send a new one.",
  },
  used: {
    title: "That link has already been used",
    body: "Each link works once, and a newer link replaces older ones. If your email is confirmed you can log in; otherwise send a new link.",
  },
  invalid: {
    title: "That link isn't valid",
    body: "It may have been copied incompletely. Enter your email and we'll send a new one.",
  },
};

function retryMinutes(res: Response): number | null {
  const seconds = Number(res.headers.get("Retry-After"));
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : null;
}

/**
 * After sign-up ("check your inbox"), and after opening a confirmation link
 * that can't be used (expired, already used, unknown). An account can't log
 * in until its email is confirmed, so this is where it gets a new link.
 */
function VerifyEmailPanelInner() {
  const params = useSearchParams();
  const status = params.get("status");
  const problem = status ? LINK_PROBLEM[status] ?? LINK_PROBLEM.invalid : null;
  const sentAtSignup = params.get("sent");
  const callbackUrl = sanitizeCallbackUrl(params.get("callbackUrl"));

  const [email, setEmail] = useState(params.get("email") ?? "");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [devUrl, setDevUrl] = useState<string | null>(null);

  useEffect(() => {
    // Only ever set on a developer's own machine with no email provider.
    try {
      const stored = sessionStorage.getItem("fystay.devVerifyUrl");
      if (stored) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing with an external system (sessionStorage) that's only readable post-mount
        setDevUrl(stored);
        sessionStorage.removeItem("fystay.devVerifyUrl");
      }
    } catch {
      // Storage unavailable: nothing to show.
    }
  }, []);

  async function resend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!email.includes("@")) {
      setNotice({ kind: "error", text: "Enter the email address you signed up with." });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(callbackUrl && { callbackUrl }) }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; devUrl?: string };
      if (res.status === 429) {
        const minutes = retryMinutes(res);
        setNotice({
          kind: "error",
          text: `You've asked for several links in a row. Please wait${minutes ? ` about ${minutes} minute${minutes === 1 ? "" : "s"}` : " a little"} and try again.`,
        });
      } else if (!res.ok) {
        setNotice({ kind: "error", text: data.error ?? "We couldn't send the email just now. Please try again in a few minutes." });
      } else {
        setNotice({ kind: "ok", text: data.message ?? "Check your inbox for a new link." });
        if (data.devUrl) setDevUrl(data.devUrl);
      }
    } catch {
      setNotice({ kind: "error", text: "Couldn't reach FYStay - check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  const loginHref = callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login";
  const sendFailed = !problem && sentAtSignup === "0";

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
      </div>
      <Card>
        <CardContent className="flex flex-col gap-4 pt-5">
          <div className="flex items-start gap-3">
            {problem || sendFailed ? (
              <MailWarning className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden />
            ) : (
              <MailCheck className="mt-0.5 h-6 w-6 shrink-0 text-brand-600" aria-hidden />
            )}
            <div>
              <h1 className="text-xl font-bold text-foreground">
                {problem ? problem.title : sendFailed ? "We couldn't send your confirmation email" : "Check your inbox"}
              </h1>
              <p className="mt-1 text-sm text-stone-600">
                {problem
                  ? problem.body
                  : sendFailed
                    ? "Your account is created, but the email didn't go. Check the address below and try again in a moment."
                    : (
                        <>
                          We&apos;ve sent a confirmation link to <strong className="break-all">{email}</strong>. Open it to finish
                          creating your account - you can log in once it&apos;s confirmed. The link works for 48 hours.
                        </>
                      )}
              </p>
            </div>
          </div>

          <form onSubmit={resend} className="flex flex-col gap-3" noValidate>
            {(problem || sendFailed) && (
              <Field>
                <Label htmlFor="verify-email">Email</Label>
                <Input id="verify-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            )}
            <Button type="submit" variant={problem || sendFailed ? "primary" : "outline"} loading={sending}>
              {sendFailed ? "Try sending again" : problem ? "Send a new link" : "Resend the email"}
            </Button>
          </form>

          {notice && (
            <p role={notice.kind === "error" ? "alert" : "status"} className={notice.kind === "error" ? "text-sm text-red-700" : "text-sm text-emerald-800"}>
              {notice.text}
            </p>
          )}

          {devUrl && (
            <p className="break-all rounded-lg bg-surface-muted p-3 text-xs text-stone-700">
              Local development only (no email provider):{" "}
              <a href={devUrl} className="font-medium text-brand-700 underline">
                Confirm email
              </a>
            </p>
          )}

          <div className="flex flex-col gap-1 text-sm text-stone-600">
            {!problem && (
              <p>
                Not there? Check spam or junk. Wrong address?{" "}
                <Link href="/register" className="font-medium text-brand-700 hover:underline">
                  Sign up again
                </Link>
                .
              </p>
            )}
            <p>
              Already confirmed?{" "}
              <Link href={loginHref} className="font-medium text-brand-700 hover:underline">
                Log in
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function VerifyEmailPanel() {
  return (
    <Suspense>
      <VerifyEmailPanelInner />
    </Suspense>
  );
}
