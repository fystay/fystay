"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Logo } from "@/components/Logo";
import { SITE_NAME } from "@/lib/seo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { AuthErrorBanner, SocialSignInButtons, useOAuthErrorMessage } from "@/components/SocialSignInButtons";
import { safeRedirectPath } from "@/lib/safeRedirect";
import { PRIVACY_EMAIL } from "@/lib/seo";

type SocialProviders = { google: boolean; apple: boolean };

type LoginFormProps = { providers: SocialProviders; rememberedProvider: string | null };

function LoginFormInner({ providers, rememberedProvider }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeRedirectPath(searchParams.get("callbackUrl"));
  // Set when the "Confirm your email" link was opened while signed out
  // (see the account page's redirect).
  const emailVerifiedOutcome =
    searchParams.get("emailConfirmed") === "1"
      ? "verified"
      : callbackUrl.startsWith("/account?")
        ? new URLSearchParams(callbackUrl.slice("/account?".length)).get("emailVerified")
        : null;
  const { message: oauthError, showHandOffError } = useOAuthErrorMessage(searchParams, rememberedProvider);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Set when Google/Apple vouched for an account that has two-factor on
  // (see src/lib/oauthTwoFactor.ts): only the code is still needed.
  const oauthTwoFactor = searchParams.get("twoFactor");
  const [needsCode, setNeedsCode] = useState(Boolean(oauthTwoFactor));
  const [error, setError] = useState<string | null>(null);
  // Set when the credentials were right but an admin has suspended the
  // account: they can't sign in, but can still reach support and ask for
  // their data.
  const [suspended, setSuspended] = useState(false);
  // Set when the password was right but the email isn't confirmed yet: no
  // session until it is, so offer a new link instead.
  const [unverified, setUnverified] = useState(false);
  const [resendState, setResendState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Set once the password (and code) are accepted: the button stays busy and
  // says where it's going until the next page is on screen, rather than
  // flicking back to "Log in" for the moment before the page changes.
  const [signedInTo, setSignedInTo] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuspended(false);
    setUnverified(false);
    setLoading(true);

    let result: Awaited<ReturnType<typeof signIn>>;
    try {
      result = oauthTwoFactor
        ? await signIn("oauth-two-factor", { code, redirect: false })
        : await signIn("credentials", {
            email,
            password,
            ...(needsCode ? { code } : {}),
            redirect: false,
          });
    } catch {
      setLoading(false);
      setError("Couldn't reach FYStay - check your connection and try again.");
      return;
    }

    setLoading(false);

    // See auth.ts's TwoFactorRequiredError - the password was right, but
    // this account needs a second-factor code that hasn't been submitted
    // yet, so show that step instead of telling the guest their password
    // was wrong.
    if (result?.code === "TwoFactorRequired") {
      setNeedsCode(true);
      return;
    }

    // See auth.ts's AccountSuspendedError - the credentials (and 2FA code,
    // if enabled) were correct, but an admin has suspended this account.
    if (result?.code === "AccountSuspended") {
      setSuspended(true);
      return;
    }

    // See auth.ts's EmailUnverifiedError.
    if (result?.code === "EmailUnverified") {
      setUnverified(true);
      setResendState("idle");
      setResendMessage(null);
      return;
    }

    if (result?.error) {
      setError(
        oauthTwoFactor
          ? "That code doesn't match, or the sign-in took too long. Check the code, or start again with the button below."
          : needsCode
            ? "That code doesn't match."
            : "That email and password don't match an account.",
      );
      return;
    }

    // A host with nowhere particular to go lands on their hosting dashboard,
    // not the guest homepage.
    let destination = callbackUrl;
    if (callbackUrl === "/") {
      const session = (await fetch("/api/auth/session").then((r) => r.json()).catch(() => null)) as {
        user?: { role?: string; name?: string | null };
      } | null;
      if (session?.user?.role === "HOST") destination = "/host/dashboard";
    }
    setSignedInTo(destination.startsWith("/host") ? "your dashboard" : destination.startsWith("/listings/") ? "your stay" : "FYStay");
    setLoading(true);
    router.push(destination);
    router.refresh();
  }

  async function resendConfirmation() {
    setResendState("sending");
    try {
      const res = await fetch("/api/auth/verify-email/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, ...(callbackUrl !== "/" && { callbackUrl }) }),
      });
      const data = (await res.json().catch(() => ({}))) as { message?: string; error?: string; devUrl?: string };
      if (!res.ok) {
        setResendState("error");
        setResendMessage(
          res.status === 429
            ? "You've asked for several links in a row. Please wait a few minutes and try again."
            : (data.error ?? "We couldn't send the email just now. Please try again in a few minutes."),
        );
        return;
      }
      if (data.devUrl) console.info("Confirmation link (local development only):", data.devUrl);
      setResendState("sent");
      setResendMessage(`We've sent a new link to ${email}. Open it, then log in here.`);
    } catch {
      setResendState("error");
      setResendMessage("Couldn't reach FYStay - check your connection and try again.");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-stone-500">
          {/* Arriving from "Log in to book": say the stay is waiting for them. */}
          {callbackUrl.startsWith("/listings/")
            ? "Log in to book your stay - your dates are saved."
            : emailVerifiedOutcome === "verified" || emailVerifiedOutcome === "already_verified"
              ? "Your email is confirmed. Log in to continue."
              : emailVerifiedOutcome === "invalid"
                ? "That email link has expired or was already used. Log in to send a new one."
                : `Log in to continue to ${SITE_NAME}`}
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <AuthErrorBanner message={oauthError} />
          {oauthTwoFactor ? (
            <p className="mb-4 text-sm text-stone-600">
              Your account uses two-step verification. Enter the code from your authenticator app to finish signing in.
            </p>
          ) : (
            <SocialSignInButtons
              providers={providers}
              callbackUrl={callbackUrl === "/" ? "/after-sign-in" : callbackUrl}
              onError={showHandOffError}
            />
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            {needsCode ? (
              <Field>
                <Label htmlFor="code">Two-factor code</Label>
                <Input
                  id="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  required
                  invalid={Boolean(error)}
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="font-mono"
                />
                <FieldError>{error}</FieldError>
              </Field>
            ) : (
              <>
                <Field>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    required
                    invalid={Boolean(error)}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </Field>
                <Field>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="mb-0">
                      Password
                    </Label>
                    <Link
                      href="/forgot-password"
                      className="mb-1.5 text-sm font-medium text-brand-700 hover:underline"
                    >
                      Forgot password?
                    </Link>
                  </div>
                  <PasswordInput
                    id="password"
                    autoComplete="current-password"
                    required
                    invalid={Boolean(error)}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <FieldError>{error}</FieldError>
                </Field>
              </>
            )}

            {suspended && (
              <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <p className="font-medium">Your account has been suspended.</p>
                <p className="mt-1">
                  To ask why or appeal, <Link href="/contact" className="font-medium underline">contact support</Link>.
                  For a copy of your account data, email{" "}
                  <a href={`mailto:${PRIVACY_EMAIL}`} className="font-medium underline">
                    {PRIVACY_EMAIL}
                  </a>
                  .
                </p>
              </div>
            )}

            {unverified && (
              <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-medium">Please confirm your email first.</p>
                <p className="mt-1">
                  Open the link we sent to <strong className="break-all">{email}</strong> when you signed up, then log in.
                </p>
                {resendMessage && (
                  <p className={resendState === "error" ? "mt-2 text-red-700" : "mt-2 text-emerald-800"}>{resendMessage}</p>
                )}
                {resendState !== "sent" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    loading={resendState === "sending"}
                    onClick={resendConfirmation}
                  >
                    Send a new link
                  </Button>
                )}
              </div>
            )}

            <Button type="submit" loading={loading} className="w-full">
              {signedInTo ? `Signed in - opening ${signedInTo}…` : needsCode ? "Verify" : "Log in"}
            </Button>
            {needsCode && (
              <button
                type="button"
                onClick={() => {
                  if (oauthTwoFactor) {
                    // Start over: the half-finished Google/Apple sign-in expires on its own.
                    router.replace("/login");
                  }
                  setNeedsCode(false);
                  setCode("");
                  setError(null);
                }}
                className="focus-ring -mt-2 self-center text-sm font-medium text-stone-500 hover:text-foreground"
              >
                Back
              </button>
            )}
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-stone-600">
        Don&apos;t have an account?{" "}
        <Link
          href={callbackUrl !== "/" ? `/register?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/register"}
          className="font-medium text-brand-700 hover:underline"
        >
          Create one
        </Link>
      </p>
    </div>
  );
}

export function LoginForm(props: LoginFormProps) {
  return (
    <Suspense>
      <LoginFormInner {...props} />
    </Suspense>
  );
}
