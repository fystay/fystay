import type { ListingReviewStatus } from "@prisma/client";
import { isConnectReady } from "@/lib/stripeConnect";

/**
 * Admin-assisted onboarding: FYStay prepares a listing for a property
 * owner, the owner reviews it and explicitly approves a specific revision,
 * and only then - once every platform check passes - can it go live.
 *
 * How the lifecycle maps onto the listing:
 *
 *   Draft                  reviewStatus DRAFT, published false
 *   Awaiting host review   reviewStatus AWAITING_HOST_REVIEW, published false
 *   Changes requested      reviewStatus CHANGES_REQUESTED, published false
 *   Host approved          reviewStatus HOST_APPROVED, approvedRevision set
 *   Ready to publish       HOST_APPROVED and publicationBlockers() is empty
 *   Live                   published true (every public query's own rule)
 *   Suspended / withdrawn  suspendedAt set / published false after going live
 *
 * A listing the host created themselves has preparedById and reviewStatus
 * null: the host wrote it, so there is nothing for them to approve, but it
 * still goes through the same publicationBlockers() before going live.
 * Where FYStay review is required (fystayReviewRequired - on by default on
 * Production), it also waits for an admin to approve it once: the approval
 * is stored in the same approvedRevision/approvedAt/approvedById fields,
 * which a self-created listing otherwise never uses.
 *
 * Everything here is pure (no database), so the rules are unit-tested
 * directly - see listingReview.test.ts.
 */

/**
 * What a guest decides or books on. A change to any of these after the
 * host approved FYStay's version needs their approval again. Guest-only
 * arrival details (check-in instructions, wifi), the calendar feed URL and
 * derived values (map pin, price-drop tracking) aren't material: they don't
 * change what was advertised.
 */
export const MATERIAL_FIELDS = {
  title: "Title",
  description: "Description",
  propertyType: "Property type",
  city: "Town",
  country: "Country",
  address: "Address",
  maxGuests: "Guests",
  bedrooms: "Bedrooms",
  beds: "Beds",
  bathrooms: "Bathrooms",
  photos: "Photos",
  amenities: "Amenities",
  pricePerNightCents: "Nightly price",
  weekendPricePerNightCents: "Weekend price",
  cleaningFeeCents: "Cleaning fee",
  securityDepositCents: "Security deposit",
  weeklyDiscountPercent: "Weekly discount",
  monthlyDiscountPercent: "Monthly discount",
  lastMinuteDiscountPercent: "Last-minute discount",
  lastMinuteWindowDays: "Last-minute window",
  cancellationPolicy: "Cancellation policy",
  customCancellationCutoffDays: "Cancellation cut-off",
  customCancellationRefundPercent: "Cancellation refund",
  minNights: "Minimum stay",
  maxNights: "Maximum stay",
  instantBook: "Instant booking",
  checkInTime: "Check-in time",
  checkOutTime: "Check-out time",
  selfCheckIn: "Self check-in",
  smokingAllowed: "Smoking",
  partiesAllowed: "Parties",
  quietHoursStart: "Quiet hours",
  quietHoursEnd: "Quiet hours",
  additionalRules: "House rules",
} as const;

export type MaterialField = keyof typeof MATERIAL_FIELDS;
export type MaterialSnapshot = { [K in MaterialField]: unknown };

/** Free-text fields where a small spelling or formatting fix isn't material. */
const TEXT_FIELDS: ReadonlySet<MaterialField> = new Set(["title", "description", "additionalRules"]);

export function materialSnapshot(listing: { [K in MaterialField]?: unknown }): MaterialSnapshot {
  const snapshot = {} as MaterialSnapshot;
  for (const field of Object.keys(MATERIAL_FIELDS) as MaterialField[]) {
    const value = listing[field];
    snapshot[field] = value === undefined ? null : value;
  }
  return snapshot;
}

const NEGATIONS = new Set(["no", "not", "non", "nor", "without", "never", "none"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = temp;
    }
  }
  return row[b.length];
}

/**
 * A correction that can't change what a guest understands: only case,
 * spacing or punctuation differ, or exactly one word's spelling was fixed
 * (at most two letters, no digits, and not a negation like "no" - adding
 * or removing one flips a claim's meaning).
 */
export function isMinorTextCorrection(before: string, after: string): boolean {
  const a = words(before);
  const b = words(after);
  if (a.length !== b.length) return false;
  const differing = a.flatMap((word, i) => (word === b[i] ? [] : [[word, b[i]] as const]));
  if (differing.length === 0) return true;
  if (differing.length > 1) return false;
  const [from, to] = differing[0];
  if (/\d/.test(from) || /\d/.test(to)) return false;
  if (NEGATIONS.has(from) || NEGATIONS.has(to)) return false;
  return editDistance(from, to) <= 2;
}

/** The labels of the material facts that differ, ignoring minor text corrections. */
export function materialChanges(before: MaterialSnapshot, after: MaterialSnapshot): string[] {
  const labels = new Set<string>();
  for (const field of Object.keys(MATERIAL_FIELDS) as MaterialField[]) {
    const a = before[field] ?? null;
    const b = after[field] ?? null;
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (TEXT_FIELDS.has(field) && typeof a === "string" && typeof b === "string" && isMinorTextCorrection(a, b)) {
      continue;
    }
    labels.add(MATERIAL_FIELDS[field]);
  }
  return [...labels];
}

/** Whether a listing goes through host review (FYStay prepared it). */
export function needsHostApproval(listing: { preparedById: string | null }): boolean {
  return listing.preparedById !== null;
}

export type ReviewActor = { id: string; role: "GUEST" | "HOST" | "ADMIN"; isListingHost: boolean };

/**
 * What a save does to the review state, given the material changes it
 * makes. Only an edit by FYStay (not the host) can invalidate the host's
 * approval: the approval is of what FYStay prepared, and a host's own
 * later edits are their own words, exactly as on a listing they created.
 * When FYStay changes something material on an approved listing it goes
 * back to the host for review - and comes down if it was live, so nothing
 * the host hasn't approved is ever shown to guests.
 */
export function reviewEffectsOfEdit(input: {
  listing: { preparedById: string | null; reviewStatus: ListingReviewStatus | null; published: boolean; materialRevision: number };
  changes: string[];
  actor: ReviewActor;
}): {
  materialRevision: number;
  reviewStatus?: ListingReviewStatus;
  unpublish: boolean;
  approvalInvalidated: boolean;
} {
  const { listing, changes, actor } = input;
  const materialRevision = changes.length > 0 ? listing.materialRevision + 1 : listing.materialRevision;
  if (!needsHostApproval(listing) || changes.length === 0 || actor.isListingHost) {
    return { materialRevision, unpublish: false, approvalInvalidated: false };
  }
  if (listing.reviewStatus === "HOST_APPROVED") {
    return {
      materialRevision,
      reviewStatus: "AWAITING_HOST_REVIEW",
      unpublish: listing.published,
      approvalInvalidated: true,
    };
  }
  return { materialRevision, unpublish: false, approvalInvalidated: false };
}

export type PublicationBlocker = {
  code:
    | "suspended"
    | "invitation_pending"
    | "not_sent_for_review"
    | "awaiting_host_review"
    | "changes_requested"
    | "awaiting_fystay_review"
    | "host_suspended"
    | "host_email_unverified"
    | "payouts_not_ready"
    | "missing_title"
    | "missing_description"
    | "missing_photos"
    | "missing_price"
    | "missing_location";
  /** One plain sentence: what's missing and who can fix it. */
  message: string;
  owner: "host" | "fystay";
};

export type PublicationInput = {
  listing: {
    title: string;
    description: string;
    city: string;
    photos: string[];
    pricePerNightCents: number;
    propertyType: string;
    suspendedAt: Date | null;
    suspendedReason: string | null;
    preparedById: string | null;
    reviewStatus: ListingReviewStatus | null;
    hostInvitationId: string | null;
    approvedRevision: number | null;
  };
  host: {
    name: string;
    emailVerifiedAt: Date | null;
    suspendedAt: Date | null;
    deletedAt: Date | null;
    stripeConnectChargesEnabled: boolean;
    stripeConnectPayoutsEnabled: boolean;
  };
  /** The owner a held draft is waiting on, when hostInvitationId is set. */
  invitation?: { name: string; email: string; sentAt: Date | null } | null;
  /** Whether payouts gate bookings here - true wherever Stripe is configured (see hostAcceptsPaidBookings). */
  payoutsRequired: boolean;
  /** Whether a listing a host created themselves needs FYStay's approval before going live (see fystayListingReviewRequired). */
  fystayReviewRequired: boolean;
};

/** A self-created listing still waiting for FYStay's one-off approval. */
export function awaitsFystayReview(
  listing: { preparedById: string | null; approvedRevision: number | null },
  fystayReviewRequired: boolean,
): boolean {
  return fystayReviewRequired && listing.preparedById === null && listing.approvedRevision === null;
}

/**
 * Everything that stops a listing going live, in the order to fix it.
 * Empty means it may be published. The same rules apply to every listing;
 * host approval is only asked of a listing FYStay prepared. Payout
 * readiness mirrors bookableHostWhere(): wherever search would hide the
 * listing for an unpayable host, publishing is refused too.
 */
export function publicationBlockers(input: PublicationInput): PublicationBlocker[] {
  const { listing, host, invitation, payoutsRequired, fystayReviewRequired } = input;
  const blockers: PublicationBlocker[] = [];

  if (listing.suspendedAt) {
    blockers.push({
      code: "suspended",
      message: `Suspended by FYStay${listing.suspendedReason ? `: ${listing.suspendedReason}` : ""}. It can't go live until FYStay lifts the suspension.`,
      owner: "fystay",
    });
  }

  if (listing.hostInvitationId) {
    blockers.push({
      code: "invitation_pending",
      message: invitation
        ? invitation.sentAt
          ? `Waiting for ${invitation.name} to accept their invitation and sign in.`
          : `${invitation.name} hasn't been sent their invitation yet.`
        : "Waiting for the owner to accept their invitation.",
      owner: invitation?.sentAt ? "host" : "fystay",
    });
  }

  if (needsHostApproval(listing)) {
    if (listing.reviewStatus === "DRAFT") {
      blockers.push({ code: "not_sent_for_review", message: "FYStay hasn't sent this to the host for review yet.", owner: "fystay" });
    } else if (listing.reviewStatus === "AWAITING_HOST_REVIEW") {
      blockers.push({ code: "awaiting_host_review", message: "Waiting for the host to check and approve the listing.", owner: "host" });
    } else if (listing.reviewStatus === "CHANGES_REQUESTED") {
      blockers.push({
        code: "changes_requested",
        message: "The host asked for changes. Make them, then send it back for approval.",
        owner: "fystay",
      });
    }
  }

  if (awaitsFystayReview(listing, fystayReviewRequired)) {
    blockers.push({
      code: "awaiting_fystay_review",
      message: "FYStay checks every new host's listing before it goes live. We'll review it and let you know.",
      owner: "fystay",
    });
  }

  if (host.suspendedAt || host.deletedAt) {
    blockers.push({ code: "host_suspended", message: "The host's account isn't active.", owner: "fystay" });
  } else if (!listing.hostInvitationId) {
    if (!host.emailVerifiedAt) {
      blockers.push({
        code: "host_email_unverified",
        message: `${host.name} needs to confirm their email address (the link is in their inbox, or resend it from Account).`,
        owner: "host",
      });
    }
    if (payoutsRequired && !isConnectReady(host)) {
      blockers.push({
        code: "payouts_not_ready",
        message: `${host.name} needs to finish payout setup with Stripe (Hosting → Payouts) so guests can pay.`,
        owner: "host",
      });
    }
  }

  if (listing.title.trim().length < 3) {
    blockers.push({ code: "missing_title", message: "Add a title.", owner: listing.preparedById ? "fystay" : "host" });
  }
  if (listing.description.trim().length < 10) {
    blockers.push({ code: "missing_description", message: "Add a description guests can rely on.", owner: listing.preparedById ? "fystay" : "host" });
  }
  if (listing.photos.length === 0) {
    blockers.push({ code: "missing_photos", message: "Add at least one photo.", owner: listing.preparedById ? "fystay" : "host" });
  }
  if (listing.propertyType !== "HOTEL" && listing.pricePerNightCents <= 0) {
    blockers.push({ code: "missing_price", message: "Set a nightly price.", owner: listing.preparedById ? "fystay" : "host" });
  }
  if (!listing.city.trim()) {
    blockers.push({ code: "missing_location", message: "Add the town the property is in.", owner: listing.preparedById ? "fystay" : "host" });
  }

  return blockers;
}

export type LifecycleStage =
  | "draft"
  | "awaiting_host_review"
  | "changes_requested"
  | "host_approved"
  | "ready_to_publish"
  | "awaiting_fystay_review"
  | "live"
  | "suspended"
  | "withdrawn"
  | "hidden";

/** The one stage to show for a listing, derived from its stored state and blockers. */
export function lifecycleStage(input: {
  listing: { published: boolean; suspendedAt: Date | null; preparedById: string | null; reviewStatus: ListingReviewStatus | null; approvedRevision: number | null };
  blockers: PublicationBlocker[];
}): LifecycleStage {
  const { listing, blockers } = input;
  if (listing.suspendedAt) return "suspended";
  if (listing.published) return "live";
  if (needsHostApproval(listing)) {
    if (listing.reviewStatus === "DRAFT") return "draft";
    if (listing.reviewStatus === "AWAITING_HOST_REVIEW") return "awaiting_host_review";
    if (listing.reviewStatus === "CHANGES_REQUESTED") return "changes_requested";
    if (listing.reviewStatus === "HOST_APPROVED") return blockers.length === 0 ? "ready_to_publish" : "host_approved";
  }
  if (blockers.some((blocker) => blocker.code === "awaiting_fystay_review")) return "awaiting_fystay_review";
  if (blockers.length === 0) return "ready_to_publish";
  return listing.approvedRevision !== null ? "withdrawn" : "hidden";
}

export const STAGE_LABEL: Record<LifecycleStage, string> = {
  draft: "Draft",
  awaiting_host_review: "Awaiting host review",
  changes_requested: "Changes requested",
  host_approved: "Host approved",
  ready_to_publish: "Ready to publish",
  awaiting_fystay_review: "Awaiting FYStay review",
  live: "Live",
  suspended: "Suspended",
  withdrawn: "Withdrawn",
  hidden: "Hidden",
};

/** Whether guests can find and book it right now (live, and its host can be paid). */
export function isPubliclyBookable(input: {
  listing: { published: boolean; suspendedAt: Date | null };
  host: { stripeConnectChargesEnabled: boolean; stripeConnectPayoutsEnabled: boolean };
  payoutsRequired: boolean;
}): boolean {
  const { listing, host, payoutsRequired } = input;
  return listing.published && !listing.suspendedAt && (!payoutsRequired || isConnectReady(host));
}
