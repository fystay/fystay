"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Gift, Home, Luggage } from "lucide-react";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referral";
import { formatPrice } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";
import { AuthErrorBanner, SocialSignInButtons, useOAuthErrorMessage } from "@/components/SocialSignInButtons";
import { cn } from "@/lib/cn";
import { SITE_NAME } from "@/lib/seo";
import { sanitizeCallbackUrl } from "@/lib/safeRedirect";
import { emailFormatError, suggestEmailCorrection } from "@/lib/emailValidation";

const roleOptions = [
  { value: "GUEST" as const, label: "Book stays", icon: Luggage },
  { value: "HOST" as const, label: "Host my place", icon: Home },
];

type SocialProviders = { google: boolean; apple: boolean };

type RegisterFormProps = { providers: SocialProviders; rememberedProvider: string | null };

function RegisterFormInner({ providers, rememberedProvider }: RegisterFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));
  const { message: oauthError, showHandOffError } = useOAuthErrorMessage(searchParams, rememberedProvider);
  // Only ever read, never validated client-side - an invalid or stale code
  // simply gets no welcome credit (see /api/signup), never a signup error.
  const referralCode = searchParams.get("ref")?.trim() || undefined;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Preselects "Host my place" when arriving from the /host landing page's
  // "List your property" CTA (?role=host), so a visitor who already read
  // the host pitch doesn't have to make the same choice twice.
  const [role, setRole] = useState<"GUEST" | "HOST">(() =>
    searchParams.get("role")?.toUpperCase() === "HOST" ? "HOST" : "GUEST",
  );
  const [termsAccepted, setTermsAccepted] = useState(false);
  // "Did you mean …?" for a likely typo (fystay.couk, gmial.com). Never
  // applied without the person choosing it; keeping the address as typed
  // is sent to the server so it doesn't ask again.
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [emailConfirmedAsTyped, setEmailConfirmedAsTyped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Catches the two mistakes a real visitor is actually likely to make
    // before round-tripping to the server at all. Deliberately not a full
    // client-side mirror of every server-side rule (e.g. email format) -
    // the API's own validation messages are human-readable backstops for
    // anything this doesn't catch.
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    const formatError = emailFormatError(email);
    if (formatError) {
      setError(formatError);
      return;
    }
    const suggestion = emailConfirmedAsTyped ? null : suggestEmailCorrection(email);
    if (suggestion) {
      setEmailSuggestion(suggestion);
      return;
    }
    if (!termsAccepted) {
      setError("You must agree to the Terms and Privacy Policy.");
      return;
    }

    setLoading(true);

    let res: Response;
    try {
      res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          password,
          role,
          referralCode,
          termsAccepted,
          emailConfirmedAsTyped,
          callbackUrl: next ?? undefined,
        }),
      });
    } catch {
      setError("Couldn't reach FYStay - check your connection and try again.");
      setLoading(false);
      return;
    }

    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      suggestion?: string;
      emailSent?: boolean;
      devVerifyUrl?: string;
    };
    if (!res.ok) {
      if (res.status === 422 && data.suggestion) setEmailSuggestion(data.suggestion);
      else setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    // No sign-in yet: the account works once the link in the email is
    // opened. The next page says whether the email actually went - a send
    // the provider refused is never shown as sent.
    if (data.devVerifyUrl) {
      try {
        sessionStorage.setItem("fystay.devVerifyUrl", data.devVerifyUrl);
      } catch {
        // Local development convenience only.
      }
    }
    const params = new URLSearchParams({ sent: data.emailSent ? "1" : "0", email: email.trim().toLowerCase() });
    if (next) params.set("callbackUrl", next);
    router.push(`/verify-email?${params}`);
  }

  // Where to land after confirming the email and logging in.
  const next = callbackUrl ?? (role === "HOST" ? "/host/dashboard" : null);

  function applySuggestion() {
    if (!emailSuggestion) return;
    setEmail(emailSuggestion);
    setEmailSuggestion(null);
    setEmailConfirmedAsTyped(false);
  }

  function keepTypedEmail() {
    setEmailSuggestion(null);
    setEmailConfirmedAsTyped(true);
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
        <h1 className="text-2xl font-bold">Create your {SITE_NAME} account</h1>
        <p className="mt-1 text-sm text-stone-500">
          {callbackUrl?.startsWith("/listings/")
            ? "It's free - we'll take you straight back to your stay with your dates saved."
            : `Join ${SITE_NAME} in a few seconds`}
        </p>
      </div>

      {referralCode && (
        <div className="mb-4 flex items-center gap-2.5 rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-800">
          <Gift className="h-4 w-4 shrink-0" aria-hidden />
          You&apos;ve been invited - sign up to get {formatPrice(REFERRAL_CREDIT_CENTS)} credit
          toward your first stay.
        </div>
      )}

      <Card>
        <CardContent className="pt-5">
          <AuthErrorBanner message={oauthError} />
          {/* Asked first, so it applies to Google/Apple sign-up too: a new
              host's choice is carried through the provider and picked up on
              /after-sign-in, instead of quietly becoming a guest account. */}
          <fieldset className="mb-4">
            <legend className="mb-1.5 text-sm font-medium text-stone-800">I want to</legend>
            <div className="grid grid-cols-2 gap-2">
              {roleOptions.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  aria-pressed={role === value}
                  className={cn(
                    "focus-ring flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm font-medium transition-colors",
                    role === value
                      ? "border-brand-600 bg-brand-50 text-brand-800"
                      : "border-border-subtle text-stone-600 hover:bg-surface-muted",
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              ))}
            </div>
          </fieldset>
          <SocialSignInButtons
            providers={providers}
            callbackUrl={callbackUrl ?? (role === "HOST" ? "/after-sign-in?as=host" : "/after-sign-in")}
            onError={showHandOffError}
          />
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <Field>
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailSuggestion(null);
                  setEmailConfirmedAsTyped(false);
                }}
                onBlur={() => {
                  if (!emailConfirmedAsTyped && !emailFormatError(email)) setEmailSuggestion(suggestEmailCorrection(email));
                }}
                aria-describedby={emailSuggestion ? "email-suggestion" : undefined}
              />
              {emailSuggestion && (
                <div id="email-suggestion" role="alert" className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
                  <p>
                    Did you mean <strong className="break-all font-semibold">{emailSuggestion}</strong>?
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button type="button" size="sm" onClick={applySuggestion}>
                      Use {emailSuggestion}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={keepTypedEmail}>
                      No, keep {email.trim()}
                    </Button>
                  </div>
                </div>
              )}
            </Field>
            <Field>
              <Label htmlFor="password">Password</Label>
              <PasswordInput
                id="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <FieldHint>At least 8 characters.</FieldHint>
            </Field>

            {/* A standalone banner, not tied to any one Field above - the
                error can be about the name, email or password, and pinning
                it under the password input regardless (as FieldError would)
                misled a visitor into thinking their password was the
                problem when it was really an empty name field. */}
            {error && <p className="text-sm text-red-600">{error}</p>}

            {/* Both pages already exist and are linked from the footer,
                but a footer link is easy to never see - tying the same
                links to the action that actually creates the account, via
                a checkbox someone has to actively tick, is what makes this
                a real recorded consent (termsAcceptedAt) rather than just a
                page that happens to exist somewhere on the site. */}
            <label className="flex items-start gap-2 text-xs text-stone-500">
              <input
                type="checkbox"
                required
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="focus-ring mt-0.5 h-4 w-4 shrink-0 rounded border-border-subtle text-brand-700"
              />
              <span>
                I agree to {SITE_NAME}&apos;s{" "}
                <Link href="/legal/terms" className="font-medium text-brand-700 hover:underline">
                  Terms and Conditions
                </Link>{" "}
                and{" "}
                <Link href="/legal/privacy" className="font-medium text-brand-700 hover:underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>

            <Button type="submit" loading={loading} className="w-full">
              Create account
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-stone-600">
        Already have an account?{" "}
        <Link
          href={callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login"}
          className="font-medium text-brand-700 hover:underline"
        >
          Log in
        </Link>
      </p>
    </div>
  );
}

export function RegisterForm(props: RegisterFormProps) {
  return (
    <Suspense>
      <RegisterFormInner {...props} />
    </Suspense>
  );
}
