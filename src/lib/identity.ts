import type Stripe from "stripe";
import type { IdentityVerificationStatus, PrismaClient } from "@prisma/client";

/**
 * Stripe Identity (stripe.com/identity) - real government-ID + selfie
 * verification, reusing the Stripe account this app already has for
 * payments rather than standing up a second vendor just for this. Uses
 * Stripe's hosted verification page (the VerificationSession's own `url`)
 * the same way checkout already redirects to Stripe-hosted Checkout,
 * rather than embedding Stripe's Identity Elements client-side.
 *
 * Never called with the metadata.userId omitted - the
 * identity.verification_session.* webhook handlers key off it to know
 * which User row a given session belongs to, since Stripe has no other
 * way to tell FYStay who was being verified.
 */
export async function createIdentityVerificationSession(
  stripe: Stripe,
  params: { userId: string; returnUrl: string },
): Promise<Stripe.Identity.VerificationSession> {
  return stripe.identity.verificationSessions.create({
    type: "document",
    metadata: { userId: params.userId },
    return_url: params.returnUrl,
    options: {
      document: {
        require_matching_selfie: true,
      },
    },
  });
}

export type IdentityState = {
  status: IdentityVerificationStatus;
  /** Submitted and being checked by Stripe - nothing for the person to do. */
  processing: boolean;
  /** Why the last attempt didn't pass, in plain words, when Stripe says. */
  failureReason: string | null;
};

// Stripe's last_error codes, reworded for the person who was being checked.
// Only the reason category - never anything read from the document itself.
const FAILURE_REASONS: Record<string, string> = {
  abandoned: "The check wasn't finished.",
  consent_declined: "The check was stopped before it finished.",
  document_expired: "The ID document had expired.",
  document_type_not_supported: "That type of ID isn't accepted. Try a passport or driving licence.",
  document_unverified_other: "The ID couldn't be verified. Make sure the photo is clear and the whole document is visible.",
  selfie_document_missing_photo: "The ID didn't show a clear photo of your face.",
  selfie_face_mismatch: "The selfie didn't match the photo on the ID.",
  selfie_manipulated: "The selfie couldn't be accepted. Take it live, in good light.",
  selfie_unverified_other: "The selfie couldn't be verified. Take it live, in good light.",
  under_supported_age: "Identity checks are only available to adults.",
  country_not_supported: "ID from that country can't be checked yet.",
  device_not_supported: "Your device couldn't take the photos. Try again on a phone with a camera.",
};

/**
 * What a Stripe VerificationSession means for the User row. Only
 * `verified` - Stripe's own decision - ever maps to VERIFIED.
 * requires_input with no last_error is a session the person opened but
 * hasn't submitted yet, so it's still PENDING (and resumable).
 */
export function identityStateFromSession(session: Stripe.Identity.VerificationSession): IdentityState {
  switch (session.status) {
    case "verified":
      return { status: "VERIFIED", processing: false, failureReason: null };
    case "processing":
      return { status: "PENDING", processing: true, failureReason: null };
    case "canceled":
      return { status: "FAILED", processing: false, failureReason: null };
    case "requires_input":
    default: {
      const code = session.last_error?.code;
      if (!code) return { status: "PENDING", processing: false, failureReason: null };
      return { status: "FAILED", processing: false, failureReason: FAILURE_REASONS[code] ?? null };
    }
  }
}

/**
 * Brings the User row in line with Stripe when the person comes back to
 * /account, so a late or missing webhook doesn't leave them stuck on
 * "In progress". Reads the session from Stripe's API (the same authority
 * the webhook relays) and updates only the row still pointing at that
 * session, exactly as the webhook does. Any Stripe error leaves the stored
 * status as it was.
 */
export async function syncIdentityVerification(
  prisma: Pick<PrismaClient, "user">,
  stripe: Stripe,
  user: { id: string; identityVerificationStatus: IdentityVerificationStatus; stripeIdentitySessionId: string | null },
): Promise<IdentityState> {
  const stored: IdentityState = { status: user.identityVerificationStatus, processing: false, failureReason: null };
  if (user.identityVerificationStatus === "VERIFIED" || user.identityVerificationStatus === "NONE") return stored;
  if (!user.stripeIdentitySessionId) return stored;

  let session: Stripe.Identity.VerificationSession;
  try {
    session = await stripe.identity.verificationSessions.retrieve(user.stripeIdentitySessionId);
  } catch {
    return stored;
  }
  const live = identityStateFromSession(session);
  if (live.status !== user.identityVerificationStatus) {
    await prisma.user.updateMany({
      where: { id: user.id, stripeIdentitySessionId: session.id },
      data: {
        identityVerificationStatus: live.status,
        ...(live.status === "VERIFIED" && { identityVerifiedAt: new Date() }),
      },
    });
  }
  return live;
}
