import { cache } from "react";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { googleSignInEnabled } from "@/lib/authProviders";
import { peekRateLimit, recordFailedAttempt, resetRateLimit } from "@/lib/rateLimit";
import { generateReferralCode } from "@/lib/referral";
import { decryptTwoFactorSecret } from "@/lib/twoFactorCrypto";
import { verifyAndConsumeBackupCode, verifyTotpCode } from "@/lib/twoFactor";
import { isSuspended } from "@/lib/suspension";

/**
 * Thrown instead of returning null when a password is correct but the
 * account has 2FA enabled and no code (or an already-consumed/invalid one)
 * was submitted. next-auth's own CredentialsSignin.type is always fixed at
 * "CredentialsSignin" for every subclass, but `code` is the one field it
 * documents as configurable per-instance and does pass through to the
 * client's signIn() result (as `result.code`) - LoginForm.tsx checks for
 * exactly this string to know when to show the code-entry step, as opposed
 * to a genuinely wrong password.
 */
class TwoFactorRequiredError extends CredentialsSignin {
  constructor() {
    super();
    this.code = "TwoFactorRequired";
  }
}

/**
 * Thrown instead of returning null when the email/password (and 2FA code,
 * if enabled) were otherwise correct but an admin has suspended this
 * account (see User.suspendedAt) - deliberately checked only after the
 * credentials themselves have already been verified, so a mere guess
 * against a suspended account's email still gets the same generic
 * "invalid credentials" response as any other wrong guess, rather than
 * leaking that the account exists and is suspended. Same code-based
 * convention as TwoFactorRequiredError above: LoginForm.tsx checks for
 * this exact "AccountSuspended" code to show a friendly, specific message
 * instead of "invalid credentials".
 */
class AccountSuspendedError extends CredentialsSignin {
  constructor() {
    super();
    this.code = "AccountSuspended";
  }
}

// Keyed by the attempted email, not the caller's IP - authorize() here has
// no access to the request, and a per-account cap on guesses is the actual
// goal (a distributed brute force spreading guesses across many IPs against
// one account is exactly what this needs to stop, not what it should miss).
// Only failed attempts count, and a success clears the count entirely - a
// real user logging in from several devices/tabs in one session can easily
// rack up more than a handful of *successful* logins, and counting those
// against the same cap as guesses would eventually lock them out of their
// own account for doing nothing wrong.
const LOGIN_RATE_LIMIT = { limit: 10, windowMs: 15 * 60 * 1000 };

const { handlers, signIn, signOut, auth: uncachedAuth } = NextAuth({
  // Trust the Host header from the deployment platform's proxy (Vercel, etc.).
  // Without this, NextAuth v5 rejects every request in production mode
  // ("UntrustedHost") since it can't otherwise tell a real request apart
  // from one with a spoofed Host header.
  trustHost: true,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
        // Only ever sent once the client already knows 2FA is required for
        // this account (see the TwoFactorRequiredError thrown below) -
        // absent on every ordinary login attempt.
        code: { label: "Two-factor code", type: "text" },
      },
      authorize: async (credentials) => {
        const email = credentials?.email;
        const password = credentials?.password;
        if (typeof email !== "string" || typeof password !== "string") {
          return null;
        }

        const normalizedEmail = email.toLowerCase();
        const rateLimitKey = `login:${normalizedEmail}`;
        // A read-only check: denies the same way a wrong password would (a
        // plain null) if already over the limit, without yet touching the
        // counter itself - a rate-limited response that looked any
        // different would itself tell an attacker their guessing was
        // noticed, and roughly how many guesses it took.
        const { allowed } = await peekRateLimit({ key: rateLimitKey, ...LOGIN_RATE_LIMIT });
        if (!allowed) return null;

        const user = await prisma.user.findUnique({
          where: { email: normalizedEmail },
        });
        // No account, or one created via Google that's never also set a
        // password: either way there's nothing to check the password
        // against, so deny rather than passing null into bcrypt.
        if (!user || !user.passwordHash) {
          await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
          return null;
        }

        const isValid = await bcrypt.compare(password, user.passwordHash);
        if (!isValid) {
          await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
          return null;
        }

        // Checked only after the password check above succeeds - never
        // before - so this never distinguishes a suspended account from a
        // wrong-password one to someone who hasn't actually proven they
        // know the password. Checked before 2FA (rather than after) since
        // there's no point asking a suspended account for a code it'll be
        // refused regardless of. Not recorded against the rate limit and
        // the limit isn't reset either, the same treatment as the
        // 2FA-required path just below: nothing was actually guessed, and
        // no real login has succeeded yet.
        if (isSuspended(user)) {
          throw new AccountSuspendedError();
        }

        if (user.twoFactorEnabledAt && user.twoFactorSecretCiphertext) {
          const code = typeof credentials?.code === "string" ? credentials.code.trim() : "";
          // No code submitted yet: the password was right, but this isn't
          // failed credentials - it's an incomplete attempt. Not recorded
          // against the rate limit (nothing was actually guessed) and the
          // limit isn't reset either (a real login hasn't succeeded yet).
          if (!code) throw new TwoFactorRequiredError();

          const secret = decryptTwoFactorSecret(user.twoFactorSecretCiphertext);
          let codeValid = verifyTotpCode(secret, code);
          if (!codeValid) {
            const { valid, remainingHashes } = await verifyAndConsumeBackupCode(
              user.twoFactorBackupCodeHashes,
              code,
            );
            codeValid = valid;
            if (valid) {
              await prisma.user.update({
                where: { id: user.id },
                data: { twoFactorBackupCodeHashes: remainingHashes },
              });
            }
          }

          if (!codeValid) {
            await recordFailedAttempt({ key: rateLimitKey, windowMs: LOGIN_RATE_LIMIT.windowMs });
            return null;
          }
        }

        await resetRateLimit(rateLimitKey);

        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          sessionVersion: user.sessionVersion,
        };
      },
    }),
    ...(googleSignInEnabled
      ? [
          Google({
            // The default profile() return has no `role` (or sessionVersion)
            // field, which this app's User type (src/types/next-auth.d.ts)
            // requires - both are only ever placeholders for the moment
            // between sign-in and the jwt callback below, which always
            // overwrites them with the real values from this account's own
            // User row.
            profile(profile) {
              return {
                id: profile.sub,
                name: profile.name,
                email: profile.email,
                image: profile.picture,
                role: "GUEST",
                sessionVersion: 1,
              };
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== "google") return true;
      if (!user.email) return false;

      const email = user.email.toLowerCase();

      // A suspended account must be blocked from signing back in via
      // Google exactly as it is via Credentials (see AccountSuspendedError
      // above) - checked before the upsert below so re-authenticating
      // never looks like a no-op success. A brand-new email has no row
      // yet, so nothing to suspend - existing is simply undefined and this
      // is a no-op for it, same as before this check existed.
      const existing = await prisma.user.findUnique({
        where: { email },
        select: { suspendedAt: true },
      });
      if (existing && isSuspended(existing)) return false;

      // Credentials sign-in already resolved to a real User row in
      // authorize() above; Google only ever hands back its own profile, so
      // the first time a given email signs in this way, create the User
      // row that everything else in this app (bookings, listings, reviews)
      // actually points to. passwordHash stays null - see the schema
      // comment on User.passwordHash for why that's a real, expected state
      // rather than a bug.
      await prisma.user.upsert({
        where: { email },
        update: {},
        // Google sign-in has no form step to carry a ?ref= code through,
        // so this account never gets a welcome credit that way - it still
        // needs its own shareable referralCode, though, to refer others.
        // termsAcceptedAt is set here, not on update: this is the one
        // moment the account is actually created, and GoogleSignInButton
        // shows the Terms/Privacy disclosure right by the button that
        // triggers this exact flow.
        create: {
          email,
          name: user.name ?? email,
          image: user.image,
          referralCode: generateReferralCode(),
          termsAcceptedAt: new Date(),
        },
      });
      return true;
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && user?.email) {
        // Google's own profile has no idea about this app's id/role - look
        // up the real User row signIn() above just found-or-created.
        const dbUser = await prisma.user.findUnique({
          where: { email: user.email.toLowerCase() },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.sessionVersion = dbUser.sessionVersion;
        }
        // Freshly stamped from the row just read above - nothing further
        // to validate this same call.
        return token;
      }
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.sessionVersion = user.sessionVersion;
        // Same reasoning as the Google branch: authorize() just read this
        // user fresh from the DB.
        return token;
      }

      // Every later read of an *existing* session (no `user` on this call -
      // see the two early returns above) re-validates against the live
      // User row instead of trusting whatever the JWT already claims. This
      // is what makes a password reset, an admin suspending this account,
      // or self-service account deletion actually end an already-issued
      // session instead of leaving it valid until NextAuth's own JWT
      // expiry (30 days by default) - and what powers the self-service
      // "sign out of all devices" action (see revokeAllSessions). auth()
      // is wrapped in React's cache() below so this only runs once per
      // request no matter how many places call it.
      const current = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { role: true, sessionVersion: true, suspendedAt: true, deletedAt: true },
      });
      if (!current || current.deletedAt || isSuspended(current) || current.sessionVersion !== token.sessionVersion) {
        return null;
      }
      // The role is re-read too, so a guest who starts hosting (see
      // /api/account/become-host) gets host access without signing out.
      token.role = current.role;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "GUEST" | "HOST" | "ADMIN";
      }
      return session;
    },
  },
});

export { handlers, signIn, signOut };
// React's cache() dedupes calls within a single request (server component
// render, or a route handler's own execution) - without it, every one of
// the ~40 call sites across this app that call auth() would each trigger
// their own full internal NextAuth round trip, including the live
// sessionVersion/suspendedAt/deletedAt lookup the jwt callback above now
// does on every session read. One request should only pay for that once.
export const auth = cache(uncachedAuth);
