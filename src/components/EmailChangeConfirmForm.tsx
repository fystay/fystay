"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, XCircle } from "lucide-react";
import { signOutToAction } from "@/actions/auth";
import { Logo } from "@/components/Logo";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";

type Status = "confirming" | "success" | "error";

function EmailChangeConfirmFormInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>(token ? "confirming" : "error");
  const [message, setMessage] = useState<string | null>(
    token ? null : "This confirmation link is missing its token.",
  );
  const [newEmail, setNewEmail] = useState<string | null>(null);
  // The confirm API is safe to call twice for the same token (see its own
  // idempotent-replay comment), but there's no reason to actually send a
  // second request for one page view - this guards against React Strict
  // Mode's dev-only double-invoke of this effect firing it twice.
  const firedRef = useRef(false);

  useEffect(() => {
    if (!token || firedRef.current) return;
    firedRef.current = true;

    // No cleanup-based cancellation here: firedRef already guarantees this
    // fetch only ever fires once for this component's lifetime, including
    // across React Strict Mode's dev-only double-invoke of this effect. A
    // "cancelled" flag tied to that first invocation's cleanup would be
    // flipped true by Strict Mode's phantom cleanup before this same fetch
    // - the one request that's actually in flight - resolves, silently
    // discarding its own result.
    fetch("/api/account/email/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setStatus("error");
          setMessage(data.error ?? "Something went wrong.");
          return;
        }
        setNewEmail(data.newEmail);
        setStatus("success");
      })
      .catch(() => {
        setStatus("error");
        setMessage("Something went wrong. Try the link again.");
      });
  }, [token]);

  return (
    <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="mb-8 flex flex-col items-center text-center">
        <Logo size="xl" withTagline className="mb-3" />
        <h1 className="text-2xl font-bold">Confirm email change</h1>
      </div>

      <Card>
        <CardContent className="flex flex-col items-center gap-3 pt-5 text-center">
          {status === "confirming" && <p className="text-sm text-stone-600">Confirming&hellip;</p>}
          {status === "success" && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-600" aria-hidden />
              <p className="text-sm text-foreground">
                Your account email is now <span className="font-medium">{newEmail}</span>.
              </p>
              <p className="text-sm text-stone-500">Log back in with your new email to continue.</p>
              {/* Deferred to this click, not run automatically the moment
                  the change succeeds above: signOutAction redirects on its
                  own, which would otherwise whisk this success message off
                  screen before the guest ever got to read it. Whatever
                  session this browser happens to be holding (which, per
                  this page's own trust model, may not even belong to this
                  account) gets cleared here regardless, before landing
                  wherever signOutAction sends it. */}
              <Button onClick={() => signOutToAction("/login")} className="mt-2 w-full">
                Go to login
              </Button>
            </>
          )}
          {status === "error" && (
            <>
              <XCircle className="h-8 w-8 text-red-600" aria-hidden />
              <p className="text-sm text-stone-600">{message}</p>
              <Link href="/account" className="mt-2 text-sm font-medium text-brand-700 hover:underline">
                Back to your account
              </Link>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function EmailChangeConfirmForm() {
  return (
    <Suspense>
      <EmailChangeConfirmFormInner />
    </Suspense>
  );
}
