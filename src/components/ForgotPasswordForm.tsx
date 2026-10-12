"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devResetUrl, setDevResetUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setSent(true);
    if (data.devMode) setDevResetUrl(data.resetUrl);
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="mt-1 text-sm text-stone-500">
          Enter your email and we&apos;ll send you a reset link.
        </p>
      </div>

      <Card>
        <CardContent className="pt-5">
          {sent ? (
            <div className="flex flex-col items-center gap-3 py-2 text-center">
              <MailCheck className="h-8 w-8 text-brand-600" />
              <p className="text-sm text-stone-600">
                If an account exists for <span className="font-medium">{email}</span>, we&apos;ve
                sent a link to reset your password. It expires in an hour.
              </p>
              {devResetUrl && (
                <div className="mt-1 w-full rounded-lg border border-dashed border-border-subtle bg-surface-muted p-3 text-left text-xs">
                  <p className="font-medium text-stone-700">
                    Dev mode: no email service is configured, so here&apos;s the link directly.
                  </p>
                  <Link href={devResetUrl} className="mt-1 block break-all text-brand-700 underline">
                    {devResetUrl}
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
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
                <FieldError>{error}</FieldError>
              </Field>

              <Button type="submit" loading={loading} className="mt-2 w-full">
                Send reset link
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <p className="mt-6 text-center text-sm text-stone-600">
        Remembered your password?{" "}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
