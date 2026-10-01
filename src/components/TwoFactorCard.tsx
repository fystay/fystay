"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Field, FieldHint, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";

type Step = "idle" | "enrolling" | "backup-codes" | "disabling";

/** `configured`: whether this deployment can offer 2FA at all (its encryption key is set) - same pattern as PhoneVerificationCard. */
export function TwoFactorCard({ initialEnabled, configured }: { initialEnabled: boolean; configured: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [step, setStep] = useState<Step>("idle");
  const [loading, setLoading] = useState(false);
  const [secret, setSecret] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function handleStartEnroll() {
    setLoading(true);
    const res = await fetch("/api/account/2fa/enroll", { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "Couldn't start two-factor setup.");
      return;
    }
    setSecret(data.secret);
    setQrCodeDataUrl(data.qrCodeDataUrl);
    setCode("");
    setStep("enrolling");
  }

  async function handleVerify() {
    setLoading(true);
    const res = await fetch("/api/account/2fa/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "That code didn't work.");
      return;
    }
    setBackupCodes(data.backupCodes);
    setEnabled(true);
    setStep("backup-codes");
  }

  async function handleDisable() {
    setLoading(true);
    const res = await fetch("/api/account/2fa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) {
      toast.error(data.error ?? "That code didn't work.");
      return;
    }
    toast.success("Two-factor authentication turned off");
    setEnabled(false);
    setCode("");
    setStep("idle");
  }

  return (
    <Card className="p-5">
      <CardHeader className="flex flex-row items-center justify-between p-0">
        <CardTitle>Two-factor authentication</CardTitle>
        {enabled ? (
          <Badge variant="success">Enabled</Badge>
        ) : (
          <Badge variant="neutral">Not enabled</Badge>
        )}
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-4 p-0">
        {step === "idle" && (
          <>
            <p className="text-sm text-stone-500">
              {enabled
                ? "You'll be asked for a code from your authenticator app each time you log in."
                : "Add an extra step at login using an authenticator app (Google Authenticator, 1Password, Authy...)."}
            </p>
            {enabled ? (
              <Button
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => {
                  setCode("");
                  setStep("disabling");
                }}
              >
                <ShieldOff className="h-4 w-4" />
                Turn off
              </Button>
            ) : !configured ? (
              <p className="text-sm text-stone-500">Two-factor authentication isn&apos;t available right now.</p>
            ) : (
              <Button size="sm" className="self-start" onClick={handleStartEnroll} loading={loading}>
                <ShieldCheck className="h-4 w-4" />
                Set up two-factor authentication
              </Button>
            )}
          </>
        )}

        {step === "enrolling" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-stone-600">
              Scan this QR code with your authenticator app, or enter the code manually, then confirm
              with a 6-digit code below.
            </p>
            {qrCodeDataUrl && (
              <Image
                src={qrCodeDataUrl}
                alt="Two-factor authentication QR code"
                width={180}
                height={180}
                unoptimized
                className="rounded-xl border border-border-subtle"
              />
            )}
            <Field>
              <Label>Can&apos;t scan? Enter this code manually</Label>
              <Input readOnly value={secret} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
            </Field>
            <Field>
              <Label htmlFor="twoFactorCode">6-digit code</Label>
              <Input
                id="twoFactorCode"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="font-mono"
              />
            </Field>
            <div className="flex gap-2">
              <Button size="sm" onClick={handleVerify} loading={loading} disabled={code.length !== 6}>
                Verify &amp; enable
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStep("idle")} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {step === "backup-codes" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-stone-600">
              Two-factor authentication is on. Save these one-time backup codes somewhere safe - each
              works once, if you ever lose access to your authenticator app. They won&apos;t be shown
              again.
            </p>
            <div className="grid grid-cols-2 gap-2 rounded-xl border border-border-subtle bg-surface-muted p-4 font-mono text-sm">
              {backupCodes.map((backupCode) => (
                <span key={backupCode}>{backupCode}</span>
              ))}
            </div>
            <Button size="sm" className="self-start" onClick={() => setStep("idle")}>
              I&apos;ve saved these
            </Button>
          </div>
        )}

        {step === "disabling" && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-stone-600">
              Enter a current code from your authenticator app (or a backup code) to turn off
              two-factor authentication.
            </p>
            <Field>
              <Label htmlFor="disableCode">Code</Label>
              <Input
                id="disableCode"
                autoComplete="one-time-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="font-mono"
              />
              <FieldHint>A 6-digit app code, or one of your backup codes.</FieldHint>
            </Field>
            <div className="flex gap-2">
              <Button size="sm" variant="danger" onClick={handleDisable} loading={loading} disabled={!code}>
                Turn off two-factor authentication
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setStep("idle")} disabled={loading}>
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
