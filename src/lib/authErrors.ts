import { isOAuthProvider, OAUTH_PROVIDER_NAMES } from "@/lib/oauthProviders";

/**
 * What the login and account pages say when a Google/Apple sign-in comes
 * back with ?error=... - Auth.js's own error types (a cancelled provider
 * screen arrives as OAuthCallbackError) and FYStay's refusals from
 * resolveOAuthSignIn. Never the raw error: unknown codes get the generic
 * line. `provider` comes from the URL or, for Auth.js's own errors (which
 * don't say which provider), from the button the person pressed.
 */
export function oauthErrorMessage(error: string | null, provider: string | null): string | null {
  if (!error) return null;
  const name = isOAuthProvider(provider) ? OAUTH_PROVIDER_NAMES[provider] : null;
  const via = name ? ` with ${name}` : "";

  switch (error) {
    case "OAuthCallbackError":
      return name ? `${name} sign-in was cancelled. Please try again.` : "Sign-in was cancelled. Please try again.";
    case "AccountExists":
      return `You already have a FYStay account with this email. Log in with your email and password below, then you can connect ${name ?? "it"} from your account page.`;
    case "AlreadyLinked":
      return `That ${name ? `${name} ` : ""}account is already connected to a different FYStay account.`;
    case "ProviderAlreadyConnected":
      return `Your FYStay account already has a different ${name ? `${name} ` : ""}account connected.`;
    case "EmailMissing":
      return `${name ?? "That provider"} didn't share an email address, which FYStay needs for your bookings. Please try again and allow your email, or sign up with email instead.`;
    case "EmailUnverified":
      return `Your ${name ? `${name} ` : ""}email address isn't verified yet. Verify it${via} and try again, or sign up with email instead.`;
    case "Suspended":
      return "Your account has been suspended. Contact support.";
    case "CredentialsSignin":
      return null;
    default:
      return `We couldn't sign you in${via}. Please try again.`;
  }
}

/** Remembers which button started a sign-in, since Auth.js's own error redirect doesn't say. Not sensitive. */
export const OAUTH_PENDING_PROVIDER_COOKIE = "fystay.oauth-provider";
