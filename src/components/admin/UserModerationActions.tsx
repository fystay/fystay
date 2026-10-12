"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Field, FieldError, FieldHint, Label } from "@/components/ui/Label";
import { Textarea } from "@/components/ui/Textarea";

/**
 * Suspend / reinstate / delete an account from its admin page. Each goes
 * through an admin-only API that checks the role again on the server; the
 * two destructive ones ask for confirmation first.
 */
export function UserModerationActions({
  userId,
  userName,
  suspended,
}: {
  userId: string;
  userName: string;
  suspended: boolean;
}) {
  const router = useRouter();
  const [dialog, setDialog] = useState<"suspend" | "delete" | null>(null);
  const [reason, setReason] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function close() {
    setDialog(null);
    setReason("");
    setConfirmText("");
    setError(null);
  }

  async function send(url: string, method: string, body: object, success: string) {
    setError(null);
    setLoading(true);
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data = await res?.json().catch(() => null);
    setLoading(false);
    if (!res?.ok) {
      const message = data?.error ?? "Couldn't reach FYStay - check your connection and try again.";
      if (dialog) setError(message);
      else toast.error(message);
      return;
    }
    toast.success(success);
    close();
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {suspended ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          loading={loading && !dialog}
          onClick={() => send(`/api/admin/users/${userId}/suspend`, "PATCH", { suspended: false }, "Account reinstated")}
        >
          Reinstate account
        </Button>
      ) : (
        <Button type="button" variant="danger" size="sm" onClick={() => setDialog("suspend")}>
          Suspend account
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" onClick={() => setDialog("delete")}>
        Delete account
      </Button>

      <Dialog open={dialog === "suspend"} onClose={close} title={`Suspend ${userName}?`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            They&apos;re signed out everywhere straight away and can&apos;t sign in, book, host or message until
            reinstated. Their bookings, listings and history stay as they are. They can still contact support.
          </p>
          <Field>
            <Label htmlFor="suspend-user-reason">Reason (kept in the admin record)</Label>
            <Textarea id="suspend-user-reason" rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Never mind
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={loading}
              onClick={() =>
                send(`/api/admin/users/${userId}/suspend`, "PATCH", { suspended: true, reason: reason.trim() || undefined }, "Account suspended")
              }
            >
              Suspend account
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={close} title={`Delete ${userName}'s account?`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-600">
            This can&apos;t be undone. Their name, email, phone and sign-in are removed and they can&apos;t sign in
            again. Bookings, payments, reviews and messages are kept, without their details, as the record hosts,
            guests and FYStay&apos;s accounts rely on. Accounts with upcoming bookings, listings or a payouts account
            can&apos;t be deleted until those are dealt with.
          </p>
          <Field>
            <Label htmlFor="delete-user-reason">Reason (kept in the admin record)</Label>
            <Textarea id="delete-user-reason" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field>
            <Label htmlFor="delete-user-confirm">Type DELETE to confirm</Label>
            <Input id="delete-user-confirm" autoComplete="off" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            <FieldHint>Capital letters.</FieldHint>
          </Field>
          <FieldError>{error}</FieldError>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={close}>
              Never mind
            </Button>
            <Button
              type="button"
              variant="danger"
              loading={loading}
              disabled={confirmText !== "DELETE"}
              onClick={() =>
                send(`/api/admin/users/${userId}`, "DELETE", { confirm: "DELETE", reason: reason.trim() || undefined }, "Account deleted")
              }
            >
              Delete account
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
