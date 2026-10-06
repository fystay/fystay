/**
 * Whether each "Continue with ..." provider is actually usable. A provider
 * is only registered in src/auth.ts, and its button only shown, once every
 * credential it needs is configured - so a deployment without them never
 * ships a button that fails the moment it's tapped.
 *
 * Google: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (Google Cloud Console).
 * Apple: APPLE_CLIENT_ID (the Services ID) + APPLE_TEAM_ID + APPLE_KEY_ID +
 * APPLE_PRIVATE_KEY (Apple Developer). See docs/launch/social-sign-in.md.
 * All server-only: none is NEXT_PUBLIC_, and none reaches the browser.
 */
export const googleSignInEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const appleSignInEnabled = Boolean(
  process.env.APPLE_CLIENT_ID &&
    process.env.APPLE_TEAM_ID &&
    process.env.APPLE_KEY_ID &&
    process.env.APPLE_PRIVATE_KEY,
);

/** Which social providers are on, for the sign-in pages and account page. */
export function enabledSocialProviders(): { google: boolean; apple: boolean } {
  return { google: googleSignInEnabled, apple: appleSignInEnabled };
}
