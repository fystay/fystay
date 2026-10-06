"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, FieldError, Label } from "@/components/ui/Label";
import { Input } from "@/components/ui/Input";
import {
  AppleIcon,
  AuthErrorBanner,
  GoogleIcon,
  startProviderSignIn,
  usePendingProvider,
} from "@/components/SocialSignInButtons";
import { oauthErrorMessage } from "@/lib/authErrors";
import { isApplePrivateRelayEmail, OAUTH_PROVIDER_NAMES, type OAuthProviderId } from "@/lib/oauthProviders";

export type ConnectedIdentity = { provider: OAuthProviderId; email: string | null };

const ICONS = { google: GoogleIcon, apple: AppleIcon } as const;

/**
 * How this account can sign in: its password (if it has one) and any
 * connected Google/Apple account. Connecting starts with the password (see
 * POST /api/account/connections), then hands off to the provider, which
 * sends the person back here. Disconnecting never removes the last way in.
 */
export function SignInMethodsCard({
  hasPassword,
  identities,
  providers,
}: {
  hasPassword: boolean;
  identities: ConnectedIdentity[];
  providers: { google: boolean; apple: boolean };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pending, setPending] = usePendingProvider();
  const [dialog, setDialog] = useState<{ provider: OAuthProviderId; action: "connect" | "disconnect" } | null>(null);
  const [password, setPassword] = useState("");
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [handOffError, setHandOffError] = useState<string | null>(null);

  // Coming back from the provider: ?connected=google on success, or
  // ?connect=google&error=... when it was refused.
  const connected = searchParams.get("connected");
  const connectError = searchParams.get("connect") ? searchParams.get("error") : null;
  const connectProvider = searchParams.get("provider");
  const banner = handOffError ?? oauthErrorMessage(connectError, connectProvider);
  useEffect(() => {
    if (connected && connected in OAUTH_PROVIDER_NAMES) {
      toast.success(`${OAUTH_PROVIDER_NAMES[connected as OAuthProviderId]} is now connected.`);
      router.replace("/account", { scroll: false });
    }
  }, [connected, router]);

  const rows = (["google", "apple"] as const).filter(
    (provider) => providers[provider] || identities.some((identity) => identity.provider === provider),
  );

  function open(provider: OAuthProviderId, action: "connect" | "disconnect") {
    setPassword("");
    setDialogError(null);
    if (!hasPassword && action === "connect") {
      // No password to confirm (the account signs in with Google/Apple).
      void connect(provider);
      return;
    }
    setDialog({ provider, action });
  }

  async function connect(provider: OAuthProviderId) {
    setSubmitting(true);
    const res = await fetch("/api/account/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, ...(hasPassword ? { currentPassword: password } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      if (dialog) setDialogError(data.error ?? "Something went wrong.");
      else toast.error(data.error ?? "Something went wrong.");
      return;
    }
    setDialog(null);
    await startProviderSignIn(provider, "/account", setPending, (p) =>
      setHandOffError(`We couldn't connect ${OAUTH_PROVIDER_NAMES[p]}. Please try again.`),
    );
  }

  async function disconnect(provider: OAuthProviderId) {
    setSubmitting(true);
    const res = await fetch("/api/account/connections", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider, ...(hasPassword ? { currentPassword: password } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    setSubmitting(false);
    if (!res.ok) {
      setDialogError(data.error ?? "Something went wrong.");
      return;
    }
    setDialog(null);
    toast.success(`${OAUTH_PROVIDER_NAMES[provider]} has been disconnected.`);
    router.refresh();
  }

  if (rows.length === 0) return null;
  const onlyWayIn = !hasPassword && identities.length === 1;

  return (
    <Card className="p-5">
      <CardHeader className="p-0">
        <CardTitle>Sign-in methods</CardTitle>
      </CardHeader>
      <CardContent className="mt-3 flex flex-col gap-4 p-0">
        <AuthErrorBanner message={banner} />

        <div className="flex items-start gap-3">
          <KeyRound className="mt-0.5 h-4.5 w-4.5 shrink-0 text-stone-500" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">Email and password</p>
            <p className="mt-0.5 text-sm text-stone-500">
              {hasPassword ? (
                "Set up"
              ) : (
                <>
                  Not set. To add one, use{" "}
                  <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
                    Forgot password
                  </Link>{" "}
                  with your account email.
                </>
              )}
            </p>
          </div>
        </div>

        {rows.map((provider) => {
          const identity = identities.find((i) => i.provider === provider);
          const Icon = ICONS[provider];
          const name = OAUTH_PROVIDER_NAMES[provider];
          return (
            <div
              key={provider}
              className="flex flex-col gap-2 border-t border-border-subtle pt-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex items-start gap-3">
                <Icon className={provider === "apple" ? "mt-0.5 h-4.5 w-4.5 shrink-0 text-black" : "mt-0.5 h-4.5 w-4.5 shrink-0"} />
                <div>
                  <p className="text-sm font-medium text-foreground">{name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-sm text-stone-500">
                    {identity ? (
                      <>
                        <CheckCircle2 className="h-3.5 w-3.5 text-brand-600" aria-hidden />
                        Connected
                        {identity.email &&
                          (isApplePrivateRelayEmail(identity.email)
                            ? " (email hidden by Apple)"
                            : ` as ${identity.email}`)}
                      </>
                    ) : (
                      "Not connected"
                    )}
                  </p>
                </div>
              </div>
              {identity ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start sm:self-auto"
                  disabled={onlyWayIn || pending !== null}
                  title={onlyWayIn ? `${name} is your only way to sign in` : undefined}
                  onClick={() => open(provider, "disconnect")}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="self-start sm:self-auto"
                  loading={pending === provider || (submitting && !dialog)}
                  disabled={pending !== null || !providers[provider]}
                  onClick={() => open(provider, "connect")}
                >
                  {pending === provider ? "Signing you in…" : "Connect"}
                </Button>
              )}
            </div>
          );
        })}
      </CardContent>

      <Dialog
        open={dialog !== null}
        onClose={() => setDialog(null)}
        title={
          dialog
            ? `${dialog.action === "connect" ? "Connect" : "Disconnect"} ${OAUTH_PROVIDER_NAMES[dialog.provider]}`
            : ""
        }
      >
        {dialog && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (dialog.action === "connect") void connect(dialog.provider);
              else void disconnect(dialog.provider);
            }}
          >
            <p className="text-sm text-stone-600">
              {dialog.action === "connect"
                ? `Enter your password to confirm it's you. You'll then sign in to ${OAUTH_PROVIDER_NAMES[dialog.provider]} and come straight back here.`
                : `You'll no longer be able to sign in with ${OAUTH_PROVIDER_NAMES[dialog.provider]}.${hasPassword ? " Enter your password to confirm." : ""}`}
            </p>
            {hasPassword ? (
              <Field className="mt-4">
                <Label htmlFor="sign-in-methods-password">Your password</Label>
                <Input
                  id="sign-in-methods-password"
                  type="password"
                  autoComplete="current-password"
                  autoFocus
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setDialogError(null);
                  }}
                  invalid={Boolean(dialogError)}
                />
                <FieldError>{dialogError}</FieldError>
              </Field>
            ) : (
              dialogError && <p className="mt-3 text-sm text-red-600">{dialogError}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setDialog(null)} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant={dialog.action === "disconnect" ? "danger" : "primary"}
                loading={submitting}
                disabled={hasPassword && !password}
              >
                {dialog.action === "connect" ? "Continue" : "Disconnect"}
              </Button>
            </div>
          </form>
        )}
      </Dialog>
    </Card>
  );
}
