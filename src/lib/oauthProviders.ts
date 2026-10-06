/** The "Continue with ..." providers. No server imports: the sign-in buttons use this too. */

export const OAUTH_PROVIDERS = ["google", "apple"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_PROVIDER_NAMES: Record<OAuthProviderId, string> = {
  google: "Google",
  apple: "Apple",
};

export function isOAuthProvider(value: unknown): value is OAuthProviderId {
  return typeof value === "string" && (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Apple's "Hide My Email" addresses. Real, deliverable addresses - just not the person's own. */
export function isApplePrivateRelayEmail(email: string): boolean {
  return /@privaterelay\.appleid\.com$/i.test(email);
}
