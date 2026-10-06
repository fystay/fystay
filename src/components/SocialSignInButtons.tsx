"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { signIn } from "next-auth/react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { OAUTH_PENDING_PROVIDER_COOKIE, oauthErrorMessage } from "@/lib/authErrors";
import { OAUTH_PROVIDER_NAMES, type OAuthProviderId } from "@/lib/oauthProviders";

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.9 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="M6.3 14.7l6.6 4.8C14.5 16 18.9 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.5 6.1 29.5 4 24 4c-7.7 0-14.3 4.3-17.7 10.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.3 35.4 26.8 36 24 36c-5.3 0-9.7-3.1-11.3-7.6l-6.5 5C9.6 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4.3 5.5l6.3 5.3C39.9 36.8 44 31 44 24c0-1.3-.1-2.7-.4-3.5z"
      />
    </svg>
  );
}

/** The Apple logo, in the text colour (Apple's guidelines allow black or white only). Path from Font Awesome Free, CC BY 4.0. */
export function AppleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 384 512" fill="currentColor" aria-hidden>
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}

const ICONS: Record<OAuthProviderId, (props: { className?: string }) => React.ReactNode> = {
  google: GoogleIcon,
  apple: AppleIcon,
};

/**
 * One "Continue with ..." button. White with a hairline border for both
 * providers - Google's own branding guidance and Apple's "white with
 * outline" style - so they sit as a matched pair above the email form
 * without outshouting it. 44px tall for an easy tap on a phone.
 */
export function SocialProviderButton({
  provider,
  pending,
  disabled,
  onClick,
  label,
}: {
  provider: OAuthProviderId;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
  label?: string;
}) {
  const Icon = ICONS[provider];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-busy={pending || undefined}
      className={cn(
        "focus-ring flex min-h-11 w-full items-center justify-center gap-2.5 rounded-full border border-border-subtle bg-white px-4 py-2.5 text-sm font-semibold text-foreground transition",
        "hover:bg-surface-muted disabled:cursor-not-allowed",
        disabled && !pending && "opacity-60",
      )}
    >
      {pending ? (
        <Loader2 className="h-4.5 w-4.5 animate-spin text-stone-500" aria-hidden />
      ) : (
        <Icon className={cn("h-4.5 w-4.5", provider === "apple" && "-mt-0.5 text-black")} />
      )}
      {pending ? "Signing you in…" : (label ?? `Continue with ${OAUTH_PROVIDER_NAMES[provider]}`)}
    </button>
  );
}

/**
 * Tracks which provider button is mid-redirect. Cleared again if the
 * person comes back to this page without finishing - pressing Back from
 * Google's or Apple's screen restores the page from the browser's cache
 * with the spinner still showing, so `pageshow` resets it.
 */
export function usePendingProvider() {
  const [pending, setPending] = useState<OAuthProviderId | null>(null);
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);
  return [pending, setPending] as const;
}

/** Hand off to the provider, restoring the button if the hand-off itself fails. */
export async function startProviderSignIn(
  provider: OAuthProviderId,
  callbackUrl: string,
  setPending: (provider: OAuthProviderId | null) => void,
  onError: (provider: OAuthProviderId) => void,
) {
  setPending(provider);
  // Lax, not httpOnly, 15 minutes: survives Apple's cross-site form POST
  // back (the redirect on to /login is a top-level GET, which Lax allows),
  // and the login page reads it to name the provider in an error.
  document.cookie = `${OAUTH_PENDING_PROVIDER_COOKIE}=${provider}; path=/; max-age=900; samesite=lax${
    window.location.protocol === "https:" ? "; secure" : ""
  }`;
  try {
    // Navigates away on success, so nothing after this runs.
    await signIn(provider, { callbackUrl });
  } catch {
    setPending(null);
    onError(provider);
  }
}

/**
 * The Google/Apple buttons, the "or" divider and the Terms disclosure for
 * the login and sign-up pages. Continuing with a provider can create an
 * account on the spot with no separate consent step, so the disclosure
 * lives here, by the buttons, not just on whichever page shows them.
 * Renders nothing when no provider is configured.
 */
export function SocialSignInButtons({
  providers,
  callbackUrl,
  onError,
}: {
  providers: { google: boolean; apple: boolean };
  callbackUrl: string;
  onError: (provider: OAuthProviderId) => void;
}) {
  const [pending, setPending] = usePendingProvider();
  const enabled = (["google", "apple"] as const).filter((provider) => providers[provider]);
  if (enabled.length === 0) return null;

  return (
    <div>
      <div className="flex flex-col gap-2.5">
        {enabled.map((provider) => (
          <SocialProviderButton
            key={provider}
            provider={provider}
            pending={pending === provider}
            disabled={pending !== null}
            onClick={() => startProviderSignIn(provider, callbackUrl, setPending, onError)}
          />
        ))}
      </div>
      <p className="mt-2.5 text-center text-xs text-stone-500">
        By continuing, you agree to our{" "}
        <Link href="/legal/terms" className="font-medium text-brand-700 hover:underline">
          Terms
        </Link>{" "}
        and{" "}
        <Link href="/legal/privacy" className="font-medium text-brand-700 hover:underline">
          Privacy Policy
        </Link>
        .
      </p>
      <div className="my-5 flex items-center gap-3 text-xs text-stone-500">
        <span className="h-px flex-1 bg-border-subtle" />
        or
        <span className="h-px flex-1 bg-border-subtle" />
      </div>
    </div>
  );
}

/**
 * The friendly message for a Google/Apple sign-in that came back with
 * ?error=..., plus a way for a failed hand-off (before ever leaving the
 * page) to show one too. Auth.js's own error redirect doesn't name the
 * provider, so the page passes in the one remembered from the button
 * (see startProviderSignIn).
 */
export function useOAuthErrorMessage(searchParams: URLSearchParams, rememberedProvider: string | null) {
  const [handOffError, setHandOffError] = useState<string | null>(null);
  const message =
    handOffError ?? oauthErrorMessage(searchParams.get("error"), searchParams.get("provider") ?? rememberedProvider);

  const showHandOffError = (provider: OAuthProviderId) =>
    setHandOffError(`We couldn't sign you in with ${OAUTH_PROVIDER_NAMES[provider]}. Please try again.`);

  return { message, showHandOffError };
}

export function AuthErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
      {message}
    </div>
  );
}
