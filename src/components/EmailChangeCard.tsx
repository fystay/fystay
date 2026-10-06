"use client";

import { useState } from "react";
import Link from "next/link";
import { MailCheck, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";

/**
 * Only rendered for an account that also has a password (see this page's
 * own hasPassword check, same gate TwoFactorCard already uses) - a
 * Google-linked account is matched by email on every sign-in, so changing
 * it here would silently disconnect Google login rather than actually
 * update it (see /api/account/email/request's own comment).
 */
export function EmailChangeCard({ currentEmail }: { currentEmail: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [devConfirmUrl, setDevConfirmUrl] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const res = await fetch("/api/account/email/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newEmail: newEmail.trim(), currentPassword }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setError(data.error ?? "Something went wrong.");
      return;
    }

    setSent(true);
    setCurrentPassword("");
    if (data.devMode) setDevConfirmUrl(data.confirmUrl);
  }

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Change email</CardTitle>
      </CardHeader>
      <CardContent className="mt-3 p-0 text-sm text-stone-600">
        {sent ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <MailCheck className="h-8 w-8 text-brand-600" aria-hidden />
            <p>
              We&rsquo;ve sent a confirmation link to <span className="font-medium">{newEmail}</span>.
              Your email won&rsquo;t change until you open it - it expires in an hour, and{" "}
              <span className="font-medium">{currentEmail}</span> stays your login until then.
            </p>
            {devConfirmUrl && (
              <div className="mt-1 w-full rounded-lg border border-dashed border-border-subtle bg-surface-muted p-3 text-left text-xs">
                <p className="font-medium text-stone-700">
                  Dev mode: no email service is configured, so here&rsquo;s the link directly.
                </p>
                <Link href={devConfirmUrl} className="mt-1 block break-all text-brand-700 underline">
                  {devConfirmUrl}
                </Link>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setSent(false);
                setNewEmail("");
                setDevConfirmUrl(null);
              }}
            >
              Use a different address
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <p>Currently {currentEmail}.</p>
            <Field>
              <Label htmlFor="new-email">New email address</Label>
              <Input
                id="new-email"
                type="email"
                required
                autoComplete="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                invalid={Boolean(error)}
                placeholder="you@example.com"
              />
            </Field>
            <Field>
              <Label htmlFor="email-change-password">Current password</Label>
              <Input
                id="email-change-password"
                type="password"
                required
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                invalid={Boolean(error)}
              />
              <FieldError>{error}</FieldError>
            </Field>
            <Button
              type="submit"
              loading={loading}
              disabled={!newEmail.trim() || !currentPassword}
              className="self-start"
            >
              <Send className="h-4 w-4" aria-hidden />
              Send link
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
