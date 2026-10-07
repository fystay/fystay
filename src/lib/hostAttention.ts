import type { PrismaClient } from "@prisma/client";

/**
 * The cheap counts behind the host menu's badges, run on every hosting
 * page: things only the host can move forward, and unread guest messages.
 */
export async function hostBadgeCounts(prisma: PrismaClient, hostId: string, now: Date = new Date()) {
  const [requests, changes, deposits, unreadMessages] = await Promise.all([
    prisma.booking.count({
      where: { listing: { hostId }, approvalStatus: "AWAITING", status: "PENDING" },
    }),
    prisma.bookingChangeRequest.count({
      where: { status: "PENDING", booking: { listing: { hostId }, status: "CONFIRMED" } },
    }),
    // A hold the host can now claim or release (the stay is over).
    prisma.booking.count({
      where: { listing: { hostId }, depositStatus: "AUTHORIZED", checkOut: { lte: now } },
    }),
    prisma.message.count({
      where: { readAt: null, senderId: { not: hostId }, conversation: { hostId } },
    }),
  ]);
  return { actionCount: requests + changes + deposits, unreadMessages };
}

export type ActionTone = "urgent" | "attention" | "info";

export type ActionItem = {
  key: string;
  tone: ActionTone;
  title: string;
  detail: string;
  href: string;
  cta: string;
  /** For ordering within a tone: soonest deadline first. */
  dueAt?: Date;
};

const TONE_ORDER: Record<ActionTone, number> = { urgent: 0, attention: 1, info: 2 };
const ICAL_STALE_MS = 48 * 60 * 60 * 1000;
const REVIEW_REPLY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The dashboard's "Needs your attention" list: everything waiting on the
 * host, worded as the next step rather than as an alarm, most pressing
 * first. Only things the host can act on appear - nothing informational
 * that would train them to ignore the list.
 */
export function buildActionItems(input: {
  now: Date;
  payoutsReady: boolean;
  hasListings: boolean;
  requests: { id: string; guestName: string; listingTitle: string; requestExpiresAt: Date | null }[];
  changeRequests: number;
  depositsToSettle: { bookingId: string; guestName: string; depositClaimDeadline: Date | null }[];
  unreadMessages: number;
  listings: {
    id: string;
    title: string;
    published: boolean;
    suspendedAt: Date | null;
    icalImportUrl: string | null;
    icalSyncedAt: Date | null;
    healthScore: number;
  }[];
  reviewsAwaitingReply: number;
  formatDeadline: (date: Date) => string;
}): ActionItem[] {
  const items: ActionItem[] = [];
  const { now } = input;

  if (input.hasListings && !input.payoutsReady) {
    items.push({
      key: "payouts",
      tone: "urgent",
      title: "Set up payouts to go live",
      detail: "Guests can't book until your Stripe account is connected.",
      href: "/host/payouts",
      cta: "Set up",
    });
  }

  for (const r of input.requests) {
    items.push({
      key: `request-${r.id}`,
      tone: "urgent",
      title: `${r.guestName} wants to book`,
      detail: `${r.listingTitle}${r.requestExpiresAt ? ` · reply by ${input.formatDeadline(r.requestExpiresAt)}` : ""}`,
      href: `/host/bookings/${r.id}`,
      cta: "Review",
      dueAt: r.requestExpiresAt ?? undefined,
    });
  }

  if (input.changeRequests > 0) {
    items.push({
      key: "changes",
      tone: "attention",
      title: `${input.changeRequests} date change request${input.changeRequests === 1 ? "" : "s"}`,
      detail: "A guest asked to change their stay.",
      href: "/host/bookings?tab=attention",
      cta: "Review",
    });
  }

  for (const d of input.depositsToSettle) {
    items.push({
      key: `deposit-${d.bookingId}`,
      tone: "attention",
      title: `Settle ${d.guestName}'s deposit`,
      detail: d.depositClaimDeadline
        ? `Released automatically on ${input.formatDeadline(d.depositClaimDeadline)} if you do nothing.`
        : "Release it or make a claim.",
      href: `/host/bookings/${d.bookingId}`,
      cta: "Settle",
      dueAt: d.depositClaimDeadline ?? undefined,
    });
  }

  if (input.unreadMessages > 0) {
    items.push({
      key: "messages",
      tone: "attention",
      title: `${input.unreadMessages} unread message${input.unreadMessages === 1 ? "" : "s"}`,
      detail: "Quick replies keep your response rate high.",
      href: "/inbox",
      cta: "Reply",
    });
  }

  for (const l of input.listings) {
    if (l.suspendedAt) {
      items.push({
        key: `suspended-${l.id}`,
        tone: "urgent",
        title: `${l.title} is paused by FYStay`,
        detail: "Contact support to get it back online.",
        href: "/help",
        cta: "Get help",
      });
      continue;
    }
    if (l.icalImportUrl && (!l.icalSyncedAt || now.getTime() - l.icalSyncedAt.getTime() > ICAL_STALE_MS)) {
      items.push({
        key: `ical-${l.id}`,
        tone: "attention",
        title: `Calendar sync is behind for ${l.title}`,
        detail: "Dates booked elsewhere may not be blocked here yet.",
        href: `/host/listings/${l.id}/calendar`,
        cta: "Sync now",
      });
    }
  }

  // Suggestions are grouped, never one line per listing: a host with twenty
  // listings needs one nudge pointing at the Listings page, not twenty.
  const hidden = input.listings.filter((l) => !l.suspendedAt && !l.published);
  const thin = input.listings.filter((l) => !l.suspendedAt && l.published && l.healthScore < 60);
  if (hidden.length > 0) {
    items.push({
      key: "unpublished",
      tone: "info",
      title:
        hidden.length === 1
          ? `${hidden[0].title} is hidden from guests`
          : `${hidden.length} listings are hidden from guests`,
      detail: "Publish when you're ready to take bookings.",
      href: "/host/listings",
      cta: "Publish",
    });
  }
  if (thin.length > 0) {
    items.push({
      key: "health",
      tone: "info",
      title: thin.length === 1 ? `Finish ${thin[0].title}` : `${thin.length} listings could use more detail`,
      detail:
        thin.length === 1
          ? `${thin[0].healthScore}% complete - a few details would help it get booked.`
          : "Photos, amenities and check-in details help them get booked.",
      href: thin.length === 1 ? `/host/listings/${thin[0].id}/edit` : "/host/listings",
      cta: "Improve",
    });
  }

  if (input.reviewsAwaitingReply > 0) {
    items.push({
      key: "reviews",
      tone: "info",
      title: `${input.reviewsAwaitingReply} new review${input.reviewsAwaitingReply === 1 ? "" : "s"} to reply to`,
      detail: "Future guests read your replies.",
      href: "/host/listings",
      cta: "Reply",
    });
  }

  return items.sort(
    (a, b) =>
      TONE_ORDER[a.tone] - TONE_ORDER[b.tone] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity),
  );
}

/** Published reviews from the last 30 days the host hasn't answered. */
export function countReviewsAwaitingReply(
  reviews: { hostResponse: string | null; createdAt: Date }[],
  now: Date = new Date(),
): number {
  return reviews.filter((r) => !r.hostResponse && now.getTime() - r.createdAt.getTime() < REVIEW_REPLY_WINDOW_MS).length;
}
