"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Label";
import { PasswordInput } from "@/components/ui/PasswordInput";
import { Button } from "@/components/ui/Button";

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    toast.success("Password updated. Log in with your new password.");
    router.push("/login");
  }

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
        <h1 className="text-2xl font-bold">Choose a new password</h1>
      </div>

      <Card>
        <CardContent className="pt-5">
          {!token ? (
            <p className="text-sm text-stone-600">
              This reset link is missing its token.{" "}
              <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
                Request a new one
              </Link>
              .
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
              <Field>
                <Label htmlFor="password">New password</Label>
                <PasswordInput
                  id="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  invalid={Boolean(error)}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <FieldHint>At least 8 characters.</FieldHint>
              </Field>
              <Field>
                <Label htmlFor="confirmPassword">Confirm new password</Label>
                <PasswordInput
                  id="confirmPassword"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  invalid={Boolean(error)}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
                <FieldError>{error}</FieldError>
              </Field>

              <Button type="submit" loading={loading} className="mt-2 w-full">
                Reset password
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {token && (
        <p className="mt-6 text-center text-sm text-stone-600">
          Link expired or not working?{" "}
          <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Request a new one
          </Link>
        </p>
      )}
    </div>
  );
}

export function ResetPasswordForm() {
  return (
    <Suspense>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
