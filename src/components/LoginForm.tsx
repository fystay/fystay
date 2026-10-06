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
import { Button } from "@/components/ui/Button";
import { AuthErrorBanner, SocialSignInButtons, useOAuthErrorMessage } from "@/components/SocialSignInButtons";
import { safeRedirectPath } from "@/lib/safeRedirect";

type SocialProviders = { google: boolean; apple: boolean };

type LoginFormProps = { providers: SocialProviders; rememberedProvider: string | null };

function LoginFormInner({ providers, rememberedProvider }: LoginFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = safeRedirectPath(searchParams.get("callbackUrl"));
  const { message: oauthError, showHandOffError } = useOAuthErrorMessage(searchParams, rememberedProvider);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await signIn("credentials", {
      email,
      password,
      ...(needsCode ? { code } : {}),
      redirect: false,
    });

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
      setError("Your account has been suspended. Contact support.");
      return;
    }

    if (result?.error) {
      setError(needsCode ? "That code doesn't match." : "That email and password don't match an account.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" className="mb-3" />
        <h1 className="text-2xl font-bold">Welcome back</h1>
        <p className="mt-1 text-sm text-stone-500">
          {/* Arriving from "Log in to book": say the stay is waiting for them. */}
          {callbackUrl.startsWith("/listings/")
            ? "Log in to book your stay - your dates are saved."
            : `Log in to continue to ${SITE_NAME}`}
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          <AuthErrorBanner message={oauthError} />
          <SocialSignInButtons providers={providers} callbackUrl={callbackUrl} onError={showHandOffError} />
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
                  <Input
                    id="password"
                    type="password"
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

            <Button type="submit" loading={loading} className="w-full">
              {needsCode ? "Verify" : "Log in"}
            </Button>
            {needsCode && (
              <button
                type="button"
                onClick={() => {
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
