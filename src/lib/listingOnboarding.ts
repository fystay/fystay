import type { ListingReviewEventType, Prisma, PrismaClient, Role } from "@prisma/client";
import { BASE_URL } from "@/lib/baseUrl";
import { EMAIL_FROM, getResendClient } from "@/lib/email";
import { escapeHtml, renderEmail } from "@/lib/emailLayout";
import { generateResetToken, hashResetToken } from "@/lib/passwordReset";
import { payoutReadinessRequired } from "@/lib/stripeConnect";
import { STANDARD_COMMISSION_RATE_TEXT } from "@/lib/pricingPolicy";
import { type EnvSource, isProductionDeployment } from "@/lib/deploymentEnvironment";
import {
  lifecycleStage,
  materialSnapshot,
  publicationBlockers,
  type LifecycleStage,
  type PublicationBlocker,
} from "@/lib/listingReview";

/**
 * Database side of admin-assisted onboarding (rules: src/lib/listingReview.ts).
 *
 * Who may do what:
 * - An admin may edit, send for review and publish only a listing FYStay
 *   prepared (preparedById set) - never a host's own listing.
 * - The host may manage a listing assigned to them (hostId), but not one
 *   still held for an invitation they haven't accepted.
 * - Only the host can approve or request changes.
 */

type Session = { user: { id: string; role: Role } } | null;

export type ManagedListing = {
  hostId: string;
  preparedById: string | null;
  hostInvitationId: string | null;
};

export function isListingHost(session: Session, listing: ManagedListing): boolean {
  return Boolean(session?.user && listing.hostId === session.user.id && !listing.hostInvitationId);
}

export function canAdminManage(session: Session, listing: ManagedListing): boolean {
  return session?.user?.role === "ADMIN" && listing.preparedById !== null;
}

export function canManageListing(session: Session, listing: ManagedListing): boolean {
  return isListingHost(session, listing) || canAdminManage(session, listing);
}

type EventDb = Pick<Prisma.TransactionClient, "listingReviewEvent">;

export async function recordReviewEvent(
  db: EventDb,
  event: {
    listingId: string;
    type: ListingReviewEventType;
    revision: number;
    actor?: { id: string; role: Role } | null;
    note?: string | null;
  },
) {
  await db.listingReviewEvent.create({
    data: {
      listingId: event.listingId,
      type: event.type,
      revision: event.revision,
      actorId: event.actor?.id ?? null,
      actorRole: event.actor?.role ?? null,
      note: event.note ?? null,
    },
  });
}

export const PUBLICATION_LISTING_SELECT = {
  id: true,
  title: true,
  description: true,
  city: true,
  photos: true,
  pricePerNightCents: true,
  propertyType: true,
  published: true,
  suspendedAt: true,
  suspendedReason: true,
  preparedById: true,
  reviewStatus: true,
  hostInvitationId: true,
  approvedRevision: true,
  materialRevision: true,
  host: {
    select: {
      id: true,
      name: true,
      email: true,
      emailVerifiedAt: true,
      suspendedAt: true,
      deletedAt: true,
      stripeConnectChargesEnabled: true,
      stripeConnectPayoutsEnabled: true,
    },
  },
  hostInvitation: { select: { id: true, name: true, email: true, sentAt: true, acceptedAt: true } },
} satisfies Prisma.ListingSelect;

/**
 * Whether a listing a host creates themselves waits for FYStay's approval
 * before going live. HOST_LISTING_REVIEW=required or =off decides it;
 * unset, it's on for Production only, so no stranger's listing takes live
 * payments unchecked while preview, local and tests keep self-publishing.
 */
export function fystayListingReviewRequired(env: EnvSource = process.env): boolean {
  const setting = env.HOST_LISTING_REVIEW?.trim().toLowerCase();
  if (setting === "required") return true;
  if (setting === "off") return false;
  return isProductionDeployment(env);
}

export type PublicationListing = Prisma.ListingGetPayload<{ select: typeof PUBLICATION_LISTING_SELECT }>;

/** Blockers and stage for a listing loaded with PUBLICATION_LISTING_SELECT. */
export function publicationState(listing: PublicationListing): {
  blockers: PublicationBlocker[];
  stage: LifecycleStage;
} {
  const blockers = publicationBlockers({
    listing,
    host: listing.host,
    invitation: listing.hostInvitation,
    payoutsRequired: payoutReadinessRequired(),
    fystayReviewRequired: fystayListingReviewRequired(),
  });
  return { blockers, stage: lifecycleStage({ listing, blockers }) };
}

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Issues a fresh invitation link (any earlier link stops working) and
 * emails it to the invited owner. Like email verification, only the
 * token's hash is stored, and the link itself is returned only on a
 * developer's own machine with no email provider.
 */
export async function sendHostInvitation(
  db: Pick<PrismaClient, "hostInvitation">,
  invitation: { id: string; email: string; name: string },
  listingTitles: string[],
  options: { local: boolean; now?: Date },
): Promise<{ sent: boolean; devUrl?: string }> {
  const now = options.now ?? new Date();
  const { token, tokenHash } = generateResetToken();
  await db.hostInvitation.update({
    where: { id: invitation.id },
    data: { tokenHash, expiresAt: new Date(now.getTime() + INVITATION_TTL_MS), sentAt: now },
  });
  const url = `${BASE_URL}/host-invitation?token=${token}`;

  const resend = getResendClient();
  if (!resend) {
    if (options.local) return { sent: false, devUrl: url };
    console.error("Host invitation not sent: email isn't configured (RESEND_API_KEY).");
    return { sent: false };
  }
  const what = listingTitles.length === 1 ? escapeHtml(listingTitles[0]) : "your property";
  const { error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: invitation.email,
    subject: "We've built your FYStay listing - ready for you to approve",
    html: renderEmail({
      audience: "host",
      preheader: "Your photos, description and prices are already in. Check it, approve it, start taking bookings.",
      heading: "Your listing is built and ready for you to approve",
      intro: `Hi ${escapeHtml(invitation.name)}, thank you for agreeing to list ${what} on FYStay. To save you the effort, we've already built the listing from the details you gave us: your photos, description, prices and house rules. Nothing is public yet. You check it, and only you decide when it goes live.`,
      cta: { label: "Review my listing", url },
      paragraphs: [
        "<strong>What's left (about 15 minutes):</strong>",
        `<strong>1. Create your free account.</strong> Use the button above and sign in or sign up with this email address (${escapeHtml(invitation.email)}). Confirm the address and the draft becomes yours.`,
        "<strong>2. Check and approve it.</strong> Look through every detail and photo, change anything you like, then approve it. We never publish anything you haven't approved.",
        "<strong>3. Set up how you get paid.</strong> Add your bank details through Stripe, our payments partner. It's secure, and FYStay never sees your card or bank details.",
        "<strong>4. Link your calendar</strong> (if you're listed elsewhere, such as Airbnb). Paste in your calendar link so your dates stay in step and you can't be double-booked.",
        "<strong>5. Go live and start taking bookings.</strong> Once you're happy and your payout details are set up, it goes live. Guests find you, and you approve each stay before it's confirmed.",
        `<strong>What it costs:</strong> nothing to list. FYStay takes a ${STANDARD_COMMISSION_RATE_TEXT} commission on each booking, with no subscription and no booking fees added for guests.`,
        "Stuck on anything? Just reply to this email and we'll help, or talk you through it on the phone.",
        "This link works for 14 days. If you weren't expecting this email, you can ignore it.",
      ],
    }),
  });
  return { sent: !error };
}

export type InvitationLookup =
  | { status: "invalid" }
  | { status: "expired" | "accepted" | "revoked"; invitation: { id: string; email: string; name: string } }
  | { status: "valid"; invitation: { id: string; email: string; name: string } };

export async function findInvitationByToken(
  db: Pick<PrismaClient, "hostInvitation">,
  token: string,
  now: Date = new Date(),
): Promise<InvitationLookup> {
  if (!/^[0-9a-f]{64}$/.test(token)) return { status: "invalid" };
  const invitation = await db.hostInvitation.findUnique({
    where: { tokenHash: hashResetToken(token) },
    select: { id: true, email: true, name: true, expiresAt: true, acceptedAt: true, revokedAt: true },
  });
  if (!invitation) return { status: "invalid" };
  const summary = { id: invitation.id, email: invitation.email, name: invitation.name };
  if (invitation.revokedAt) return { status: "revoked", invitation: summary };
  if (invitation.acceptedAt) return { status: "accepted", invitation: summary };
  if (!invitation.expiresAt || invitation.expiresAt <= now) return { status: "expired", invitation: summary };
  return { status: "valid", invitation: summary };
}

export type AcceptResult =
  | { ok: true; listingIds: string[] }
  | { ok: false; reason: "invalid" | "expired" | "accepted" | "revoked" | "wrong_account" | "email_unverified" | "account_inactive" };

/**
 * Hands the held draft(s) to the invited owner. Requires the signed-in
 * account's own, verified email to be the invited address - the link alone
 * never grants access, so a forwarded or intercepted link is useless to
 * anyone else. Turns hosting on for a guest account (as "Become a host"
 * does) and records who got access and when. Approval is a separate,
 * explicit step: accepting grants access, nothing more.
 */
export async function acceptHostInvitation(
  db: Pick<PrismaClient, "hostInvitation" | "user" | "$transaction">,
  token: string,
  userId: string,
  now: Date = new Date(),
): Promise<AcceptResult> {
  const lookup = await findInvitationByToken(db, token, now);
  if (lookup.status !== "valid") return { ok: false, reason: lookup.status };

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, emailVerifiedAt: true, suspendedAt: true, deletedAt: true },
  });
  if (!user || user.suspendedAt || user.deletedAt) return { ok: false, reason: "account_inactive" };
  if (normalizeEmail(user.email) !== normalizeEmail(lookup.invitation.email)) return { ok: false, reason: "wrong_account" };
  if (!user.emailVerifiedAt) return { ok: false, reason: "email_unverified" };

  return db.$transaction(async (tx) => {
    const claimed = await tx.hostInvitation.updateMany({
      where: { id: lookup.invitation.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: now, acceptedById: user.id, tokenHash: null },
    });
    if (claimed.count === 0) return { ok: false as const, reason: "accepted" as const };

    if (user.role === "GUEST") {
      await tx.user.update({ where: { id: user.id }, data: { role: "HOST" } });
    }
    const listings = await tx.listing.findMany({
      where: { hostInvitationId: lookup.invitation.id },
      select: { id: true, materialRevision: true },
    });
    await tx.listing.updateMany({
      where: { hostInvitationId: lookup.invitation.id },
      data: { hostId: user.id, hostInvitationId: null },
    });
    for (const listing of listings) {
      await recordReviewEvent(tx, {
        listingId: listing.id,
        type: "HOST_ACCESS_GRANTED",
        revision: listing.materialRevision,
        actor: { id: user.id, role: user.role === "GUEST" ? "HOST" : user.role },
      });
    }
    return { ok: true as const, listingIds: listings.map((l) => l.id) };
  });
}

/** Best-effort notice to a host or admin about a review step; never blocks the step itself. `intro` is HTML: escape anything user-entered in it. */
export async function sendReviewNotice(to: { email: string; name: string }, notice: {
  subject: string;
  heading: string;
  intro: string;
  cta: { label: string; path: string };
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;
  await resend.emails
    .send({
      from: EMAIL_FROM,
      to: to.email,
      subject: notice.subject,
      html: renderEmail({
        audience: "host",
        preheader: notice.heading,
        heading: notice.heading,
        intro: `Hi ${escapeHtml(to.name)}, ${notice.intro}`,
        cta: { label: notice.cta.label, url: `${BASE_URL}${notice.cta.path}` },
      }),
    })
    .catch((error: unknown) => console.error("Review notice not sent", error));
}

/** The approval record for the revision the host is approving. */
export function approvalData(
  listing: Parameters<typeof materialSnapshot>[0] & { materialRevision: number },
  hostId: string,
  now: Date,
) {
  return {
    reviewStatus: "HOST_APPROVED" as const,
    approvedRevision: listing.materialRevision,
    approvedAt: now,
    approvedById: hostId,
    approvedSnapshot: materialSnapshot(listing) as Prisma.InputJsonValue,
  };
}
