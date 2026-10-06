import { Prisma, type PrismaClient } from "@prisma/client";
import { generateReferralCode } from "@/lib/referral";
import { isSuspended } from "@/lib/suspension";
import type { OAuthProviderId } from "@/lib/oauthProviders";

export { OAUTH_PROVIDERS, OAUTH_PROVIDER_NAMES, isApplePrivateRelayEmail, isOAuthProvider } from "@/lib/oauthProviders";
export type { OAuthProviderId } from "@/lib/oauthProviders";

export type OAuthSignInInput = {
  provider: OAuthProviderId;
  /** The provider's stable id for this person (OIDC "sub"). */
  providerAccountId: string;
  email: string | null | undefined;
  /** Whether the provider vouches that this person controls `email`. */
  emailVerified: boolean;
  name: string | null | undefined;
  image: string | null | undefined;
  /**
   * Set only from a verified link intent (src/lib/oauthLinkIntent.ts): a
   * signed-in person who re-entered their password and asked to connect
   * this provider to their account.
   */
  linkToUserId?: string | null;
};

/**
 * Why a sign-in was refused, as shown to the person (see
 * src/lib/authErrors.ts for the wording):
 * - AccountExists: an account with this email signs in with a password;
 *   log in with it, then connect the provider from the account page.
 * - AlreadyLinked: this Google/Apple account is already connected to a
 *   different FYStay account.
 * - ProviderAlreadyConnected: this FYStay account already has a different
 *   Google/Apple account connected.
 */
export type OAuthSignInRefusal =
  | "AccountExists"
  | "AlreadyLinked"
  | "ProviderAlreadyConnected"
  | "EmailMissing"
  | "EmailUnverified"
  | "Suspended";

export type OAuthSignInResult =
  | { ok: true; userId: string; created: boolean; linked: boolean }
  | { ok: false; reason: OAuthSignInRefusal };

type Db = Pick<PrismaClient, "user" | "authIdentity" | "$transaction">;

const FALLBACK_NAME = "FYStay guest";

function displayName(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed.slice(0, 100) : FALLBACK_NAME;
}

/**
 * Decides which FYStay account a Google/Apple sign-in belongs to, creating
 * or linking it when that's safe.
 *
 * 1. A known identity (provider + its stable id) signs in to its account.
 * 2. From the account page, a signed-in person who re-entered their
 *    password links a new identity to their own account.
 * 3. Otherwise, by email - and only an email the provider has verified:
 *    - no account with that email: a new account is created;
 *    - an account that has no password (it was itself created through
 *      Google or Apple): the identity is linked to it, since the same
 *      verified inbox is behind both;
 *    - an account that has a password: refused. Linking it here would let
 *      whoever controls a Google/Apple account with that address skip the
 *      password (and its two-factor code). The person logs in with the
 *      password and connects the provider from the account page instead.
 *
 * Never rewrites an existing account's name or photo: those are the
 * person's own to edit. A missing photo is filled in, nothing more.
 */
export async function resolveOAuthSignIn(db: Db, input: OAuthSignInInput, retried = false): Promise<OAuthSignInResult> {
  try {
    return await resolve(db, input);
  } catch (error) {
    // Two first sign-ins racing (a double tap) can both pass the checks
    // below and collide on a unique index; the second simply re-resolves
    // and finds what the first created.
    if (!retried && error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return resolveOAuthSignIn(db, input, true);
    }
    throw error;
  }
}

async function resolve(db: Db, input: OAuthSignInInput): Promise<OAuthSignInResult> {
  const { provider, providerAccountId } = input;
  const email = input.email?.trim().toLowerCase() || null;

  const identity = await db.authIdentity.findUnique({
    where: { provider_providerAccountId: { provider, providerAccountId } },
    select: { userId: true, user: { select: { suspendedAt: true, deletedAt: true } } },
  });

  if (identity) {
    if (input.linkToUserId && input.linkToUserId !== identity.userId) {
      return { ok: false, reason: "AlreadyLinked" };
    }
    // Account deletion removes identities, so a deleted account here would
    // be a leftover; treat it like a suspended one rather than signing in.
    if (identity.user.deletedAt || isSuspended(identity.user)) return { ok: false, reason: "Suspended" };
    return { ok: true, userId: identity.userId, created: false, linked: false };
  }

  if (input.linkToUserId) {
    const user = await db.user.findUnique({
      where: { id: input.linkToUserId },
      select: { id: true, image: true, suspendedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt || isSuspended(user)) return { ok: false, reason: "Suspended" };
    const existingForProvider = await db.authIdentity.findFirst({
      where: { userId: user.id, provider },
      select: { id: true },
    });
    if (existingForProvider) return { ok: false, reason: "ProviderAlreadyConnected" };
    await db.authIdentity.create({ data: { userId: user.id, provider, providerAccountId, email } });
    return { ok: true, userId: user.id, created: false, linked: true };
  }

  if (!email) return { ok: false, reason: "EmailMissing" };
  if (!input.emailVerified) return { ok: false, reason: "EmailUnverified" };

  const existing = await db.user.findUnique({
    where: { email },
    select: { id: true, passwordHash: true, image: true, suspendedAt: true, deletedAt: true },
  });

  if (existing) {
    if (existing.deletedAt || isSuspended(existing)) return { ok: false, reason: "Suspended" };
    if (existing.passwordHash) return { ok: false, reason: "AccountExists" };
    const existingForProvider = await db.authIdentity.findFirst({
      where: { userId: existing.id, provider },
      select: { id: true },
    });
    if (existingForProvider) return { ok: false, reason: "ProviderAlreadyConnected" };
    await db.$transaction([
      db.authIdentity.create({ data: { userId: existing.id, provider, providerAccountId, email } }),
      ...(existing.image || !input.image
        ? []
        : [db.user.update({ where: { id: existing.id }, data: { image: input.image } })]),
    ]);
    return { ok: true, userId: existing.id, created: false, linked: true };
  }

  const created = await db.user.create({
    data: {
      email,
      name: displayName(input.name),
      image: input.image || null,
      // Google and Apple sign-in have no form step to carry a ?ref= code,
      // so no welcome credit - but the account still gets its own code to
      // refer others.
      referralCode: generateReferralCode(),
      // The sign-in buttons show the Terms/Privacy disclosure right where
      // this flow starts (see SocialSignInButtons), and this is the moment
      // the account comes into being.
      termsAcceptedAt: new Date(),
      authIdentities: { create: { provider, providerAccountId, email } },
    },
    select: { id: true },
  });
  return { ok: true, userId: created.id, created: true, linked: false };
}

/** The OIDC email_verified claim, which Apple sends as the string "true". */
export function claimIsTrue(value: unknown): boolean {
  return value === true || value === "true";
}
