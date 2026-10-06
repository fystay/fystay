"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Gift, Home, Luggage } from "lucide-react";
import { REFERRAL_CREDIT_CENTS } from "@/lib/referral";
import { formatPrice } from "@/lib/format";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { cn } from "@/lib/cn";
import { SITE_NAME } from "@/lib/seo";
import { sanitizeCallbackUrl } from "@/lib/safeRedirect";

const roleOptions = [
  { value: "GUEST" as const, label: "Book stays", icon: Luggage },
  { value: "HOST" as const, label: "Host my place", icon: Home },
];

function RegisterFormInner({ googleEnabled }: { googleEnabled: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = sanitizeCallbackUrl(searchParams.get("callbackUrl"));
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
    if (!termsAccepted) {
      setError("You must agree to the Terms and Privacy Policy.");
      return;
    }

    setLoading(true);

    const res = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role, referralCode, termsAccepted }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Something went wrong.");
      setLoading(false);
      return;
    }

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      router.push(callbackUrl ? `/login?callbackUrl=${encodeURIComponent(callbackUrl)}` : "/login");
      return;
    }

    router.push(callbackUrl ?? (role === "HOST" ? "/host/dashboard" : "/"));
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" className="mb-3" />
        <h1 className="text-2xl font-bold">Create your account</h1>
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
          {googleEnabled && (
            <>
              <GoogleSignInButton callbackUrl={callbackUrl ?? undefined} />
              <div className="my-4 flex items-center gap-3 text-xs text-stone-500">
                <span className="h-px flex-1 bg-border-subtle" />
                or
                <span className="h-px flex-1 bg-border-subtle" />
              </div>
            </>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
            <fieldset>
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
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
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
              Sign up
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

export function RegisterForm({ googleEnabled }: { googleEnabled: boolean }) {
  return (
    <Suspense>
      <RegisterFormInner googleEnabled={googleEnabled} />
    </Suspense>
  );
}
