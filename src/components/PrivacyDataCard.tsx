"use client";

import { useState } from "react";
import { Download, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { signOutAction } from "@/actions/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button, buttonVariants } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { cn } from "@/lib/cn";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";

const BLOCK_MESSAGES: Record<string, string> = {
  upcoming_bookings_as_guest: "You have an upcoming or in-progress booking - cancel it first.",
  listings_still_exist:
    "You still have listings - delete them first. A listing that has had bookings can't be deleted; contact support to close a hosting account.",
  stripe_connect_active: "Your Stripe payouts account is still active - contact us to close it before deleting your account.",
};

/** hasPassword: the account signs in with a password, so deleting it asks for that password again. */
export function PrivacyDataCard({ hasPassword }: { hasPassword: boolean }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function closeDialog() {
    setConfirmOpen(false);
    setPassword("");
    setPasswordError(null);
  }

  async function handleDelete() {
    if (hasPassword && !password) {
      setPasswordError("Enter your password to delete your account.");
      return;
    }
    setDeleting(true);
    const res = await fetch("/api/account", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(hasPassword ? { currentPassword: password } : {}),
    });
    const data = await res.json();
    setDeleting(false);

    if (!res.ok) {
      if (res.status === 400 && hasPassword) {
        setPasswordError(data.error ?? "That password isn't right.");
        return;
      }
      closeDialog();
      const blocks: string[] = data.blocks ?? [];
      if (blocks.length > 0) {
        blocks.forEach((block) => toast.error(BLOCK_MESSAGES[block] ?? "Couldn't delete your account."));
      } else {
        toast.error(data.error ?? "Couldn't delete your account.");
      }
      return;
    }

    toast.success("Your account has been deleted");
    await signOutAction();
  }

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Privacy &amp; data</CardTitle>
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-5 p-0">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Download your data</p>
            <p className="mt-0.5 text-sm text-stone-500">
              A copy of your profile, bookings, reviews and messages as a JSON file.
            </p>
          </div>
          <a
            href="/api/account/export"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start sm:self-auto")}
          >
            <Download className="h-4 w-4" />
            Download
          </a>
        </div>

        <div className="flex flex-col gap-2 border-t border-border-subtle pt-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-foreground">Delete your account</p>
            <p className="mt-0.5 text-sm text-stone-500">
              Permanently removes your personal details. Past bookings and reviews stay on record
              for other guests/hosts and for our own financial records, but are no longer linked to
              your name.
            </p>
          </div>
          <Button
            variant="danger"
            size="sm"
            onClick={() => setConfirmOpen(true)}
            className="self-start sm:self-auto"
          >
            <ShieldAlert className="h-4 w-4" />
            Delete account
          </Button>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirmOpen}
        onClose={closeDialog}
        onConfirm={handleDelete}
        title="Delete your account?"
        description="This can't be undone. Your name, email and phone number are removed everywhere; you'll be signed out immediately."
        confirmLabel="Delete my account"
        loading={deleting}
        danger
      >
        {hasPassword && (
          <Field className="mt-4">
            <Label htmlFor="delete-account-password">Your password</Label>
            <Input
              id="delete-account-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              invalid={Boolean(passwordError)}
            />
            <FieldError>{passwordError}</FieldError>
          </Field>
        )}
      </ConfirmDialog>
    </Card>
  );
}
