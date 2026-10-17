import { describe, expect, it } from "vitest";
import {
  isMinorTextCorrection,
  isPubliclyBookable,
  lifecycleStage,
  materialChanges,
  materialSnapshot,
  publicationBlockers,
  reviewEffectsOfEdit,
  type PublicationInput,
} from "./listingReview";

const baseListing = {
  title: "Lodge on the Lake",
  description: "A three-bedroom lodge with a deck over the water.",
  propertyType: "HOUSE",
  city: "Carnforth",
  country: "United Kingdom",
  address: null,
  maxGuests: 6,
  bedrooms: 3,
  beds: 4,
  bathrooms: 2,
  photos: ["https://example.test/1.jpg", "https://example.test/2.jpg"],
  amenities: ["Wifi", "Parking"],
  pricePerNightCents: 25500,
  weekendPricePerNightCents: 27500,
  cleaningFeeCents: 0,
  securityDepositCents: 0,
  weeklyDiscountPercent: null,
  monthlyDiscountPercent: null,
  lastMinuteDiscountPercent: null,
  lastMinuteWindowDays: null,
  cancellationPolicy: "NON_REFUNDABLE",
  customCancellationCutoffDays: null,
  customCancellationRefundPercent: null,
  minNights: 2,
  maxNights: null,
  instantBook: false,
  checkInTime: "4pm",
  checkOutTime: "10am",
  selfCheckIn: false,
  smokingAllowed: false,
  partiesAllowed: false,
  quietHoursStart: null,
  quietHoursEnd: null,
  additionalRules: "No stag or hen groups.",
};

const snap = (overrides: Partial<typeof baseListing> = {}) => materialSnapshot({ ...baseListing, ...overrides });

describe("material changes", () => {
  it("finds nothing when nothing a guest relies on changed", () => {
    expect(materialChanges(snap(), snap())).toEqual([]);
  });

  it("treats prices, photos, capacity, rules and policy as material", () => {
    expect(materialChanges(snap(), snap({ pricePerNightCents: 26000 }))).toEqual(["Nightly price"]);
    expect(materialChanges(snap(), snap({ photos: [baseListing.photos[1], baseListing.photos[0]] }))).toEqual(["Photos"]);
    expect(materialChanges(snap(), snap({ maxGuests: 8 }))).toEqual(["Guests"]);
    expect(materialChanges(snap(), snap({ smokingAllowed: true }))).toEqual(["Smoking"]);
    expect(materialChanges(snap(), snap({ cancellationPolicy: "FLEXIBLE" }))).toEqual(["Cancellation policy"]);
    expect(materialChanges(snap(), snap({ amenities: ["Wifi", "Parking", "Hot tub"] }))).toEqual(["Amenities"]);
  });

  it("ignores guest-only and derived fields", () => {
    const before = materialSnapshot({ ...baseListing, checkInInstructions: "Key in the lockbox" } as never);
    const after = materialSnapshot({ ...baseListing, checkInInstructions: "Code 1234", wifiPassword: "x" } as never);
    expect(materialChanges(before, after)).toEqual([]);
  });

  it("lets small spelling, case and punctuation fixes through", () => {
    expect(isMinorTextCorrection("A lovley lodge", "A lovely lodge")).toBe(true);
    expect(isMinorTextCorrection("A lodge, by the lake", "A lodge by the lake.")).toBe(true);
    expect(materialChanges(snap(), snap({ description: "A three-bedroom lodge with a deck over the watter." }))).toEqual([]);
  });

  it("never treats a changed claim, number or negation as minor", () => {
    expect(isMinorTextCorrection("Sleeps 6", "Sleeps 8")).toBe(false);
    expect(isMinorTextCorrection("No hot tub", "Hot tub")).toBe(false);
    expect(isMinorTextCorrection("Parking not included", "Parking is included")).toBe(false);
    expect(isMinorTextCorrection("A quiet lodge", "A quiet lodge with a hot tub")).toBe(false);
    expect(isMinorTextCorrection("Two bedrooms and a garden", "Three bedrooms and a pool")).toBe(false);
  });
});

describe("review effects of an edit", () => {
  const admin = { id: "admin_1", role: "ADMIN" as const, isListingHost: false };
  const host = { id: "host_1", role: "HOST" as const, isListingHost: true };
  const approved = { preparedById: "admin_1", reviewStatus: "HOST_APPROVED" as const, published: false, materialRevision: 3 };

  it("sends an approved listing back to the host when FYStay changes something material", () => {
    expect(reviewEffectsOfEdit({ listing: approved, changes: ["Nightly price"], actor: admin })).toEqual({
      materialRevision: 4,
      reviewStatus: "AWAITING_HOST_REVIEW",
      unpublish: false,
      approvalInvalidated: true,
    });
  });

  it("takes a live listing down until the host re-approves FYStay's change", () => {
    const effects = reviewEffectsOfEdit({ listing: { ...approved, published: true }, changes: ["Photos"], actor: admin });
    expect(effects.unpublish).toBe(true);
    expect(effects.reviewStatus).toBe("AWAITING_HOST_REVIEW");
  });

  it("keeps the approval for a minor (non-material) FYStay correction", () => {
    expect(reviewEffectsOfEdit({ listing: approved, changes: [], actor: admin })).toEqual({
      materialRevision: 3,
      unpublish: false,
      approvalInvalidated: false,
    });
  });

  it("never infers or resets approval from the host's own edits", () => {
    const effects = reviewEffectsOfEdit({ listing: approved, changes: ["Nightly price"], actor: host });
    expect(effects).toEqual({ materialRevision: 4, unpublish: false, approvalInvalidated: false });
    const awaiting = reviewEffectsOfEdit({
      listing: { ...approved, reviewStatus: "AWAITING_HOST_REVIEW" },
      changes: ["Nightly price"],
      actor: host,
    });
    expect(awaiting.reviewStatus).toBeUndefined();
  });

  it("leaves a host's own listing out of review entirely", () => {
    const effects = reviewEffectsOfEdit({
      listing: { preparedById: null, reviewStatus: null, published: true, materialRevision: 1 },
      changes: ["Nightly price"],
      actor: host,
    });
    expect(effects).toEqual({ materialRevision: 2, unpublish: false, approvalInvalidated: false });
  });
});

const readyHost: PublicationInput["host"] = {
  name: "Sam",
  emailVerifiedAt: new Date(),
  suspendedAt: null,
  deletedAt: null,
  stripeConnectChargesEnabled: true,
  stripeConnectPayoutsEnabled: true,
};
const publication = (overrides: Partial<PublicationInput["listing"]> = {}, host = readyHost, payoutsRequired = true): PublicationInput => ({
  listing: {
    title: baseListing.title,
    description: baseListing.description,
    city: baseListing.city,
    photos: baseListing.photos,
    pricePerNightCents: baseListing.pricePerNightCents,
    propertyType: "HOUSE",
    suspendedAt: null,
    suspendedReason: null,
    preparedById: null,
    reviewStatus: null,
    hostInvitationId: null,
    approvedRevision: null,
    ...overrides,
  },
  host,
  payoutsRequired,
  fystayReviewRequired: false,
});
const codes = (input: PublicationInput) => publicationBlockers(input).map((b) => b.code);

describe("publication blockers", () => {
  it("lets a complete host-created listing with a ready host go live", () => {
    expect(codes(publication())).toEqual([]);
  });

  it("requires the host's approval for a listing FYStay prepared", () => {
    expect(codes(publication({ preparedById: "admin_1", reviewStatus: "DRAFT" }))).toEqual(["not_sent_for_review"]);
    expect(codes(publication({ preparedById: "admin_1", reviewStatus: "AWAITING_HOST_REVIEW" }))).toEqual(["awaiting_host_review"]);
    expect(codes(publication({ preparedById: "admin_1", reviewStatus: "CHANGES_REQUESTED" }))).toEqual(["changes_requested"]);
    expect(codes(publication({ preparedById: "admin_1", reviewStatus: "HOST_APPROVED" }))).toEqual([]);
  });

  it("blocks a draft still held for an owner who hasn't accepted their invitation", () => {
    const input = {
      ...publication({ preparedById: "admin_1", reviewStatus: "HOST_APPROVED", hostInvitationId: "inv_1" }),
      invitation: { name: "Pat", email: "pat@example.test", sentAt: new Date() },
    };
    expect(codes(input)).toEqual(["invitation_pending"]);
  });

  it("requires a verified host email and, where payments are on, payout readiness", () => {
    expect(codes(publication({}, { ...readyHost, emailVerifiedAt: null }))).toEqual(["host_email_unverified"]);
    const unpaid = { ...readyHost, stripeConnectPayoutsEnabled: false };
    expect(codes(publication({}, unpaid, true))).toEqual(["payouts_not_ready"]);
    // Mirrors bookableHostWhere: with no Stripe configured, payouts don't gate anything.
    expect(codes(publication({}, unpaid, false))).toEqual([]);
  });

  it("keeps suspended listings and inactive hosts offline", () => {
    expect(codes(publication({ suspendedAt: new Date(), suspendedReason: "Fraud check" }))).toContain("suspended");
    expect(codes(publication({}, { ...readyHost, suspendedAt: new Date() }))).toContain("host_suspended");
  });

  it("requires the basic details guests book on", () => {
    expect(codes(publication({ description: "", photos: [], pricePerNightCents: 0, city: " " }))).toEqual([
      "missing_description",
      "missing_photos",
      "missing_price",
      "missing_location",
    ]);
  });
});

describe("FYStay review of a host's own listing", () => {
  const reviewed = (overrides: Partial<PublicationInput["listing"]> = {}) => ({ ...publication(overrides), fystayReviewRequired: true });

  it("holds a host's own listing until FYStay approves it, where review is required", () => {
    expect(codes(reviewed())).toEqual(["awaiting_fystay_review"]);
    expect(publicationBlockers(reviewed())[0].owner).toBe("fystay");
    expect(codes(reviewed({ approvedRevision: 1 }))).toEqual([]);
  });

  it("doesn't ask it of a listing FYStay prepared (the host approves that one) or where review is off", () => {
    expect(codes(reviewed({ preparedById: "admin_1", reviewStatus: "HOST_APPROVED", approvedRevision: 1 }))).toEqual([]);
    expect(codes(publication())).toEqual([]);
  });

  it("still applies every other check after approval", () => {
    expect(codes(reviewed({ approvedRevision: 1, photos: [] }))).toEqual(["missing_photos"]);
  });

  it("shows the waiting listing as awaiting FYStay review", () => {
    const listing = { published: false, suspendedAt: null, preparedById: null, reviewStatus: null, approvedRevision: null };
    expect(lifecycleStage({ listing, blockers: publicationBlockers(reviewed()) })).toBe("awaiting_fystay_review");
    expect(lifecycleStage({ listing: { ...listing, approvedRevision: 1 }, blockers: [] })).toBe("ready_to_publish");
  });
});

describe("lifecycle stage", () => {
  const listing = { published: false, suspendedAt: null, preparedById: "admin_1", reviewStatus: "HOST_APPROVED" as const, approvedRevision: 2 };
  it("maps stored state and blockers onto one stage", () => {
    expect(lifecycleStage({ listing, blockers: [] })).toBe("ready_to_publish");
    expect(lifecycleStage({ listing, blockers: publicationBlockers(publication({}, { ...readyHost, emailVerifiedAt: null })) })).toBe("host_approved");
    expect(lifecycleStage({ listing: { ...listing, reviewStatus: "DRAFT" }, blockers: [] })).toBe("draft");
    expect(lifecycleStage({ listing: { ...listing, published: true }, blockers: [] })).toBe("live");
    expect(lifecycleStage({ listing: { ...listing, published: true, suspendedAt: new Date() }, blockers: [] })).toBe("suspended");
  });
});

describe("public bookability", () => {
  it("needs published, not suspended and (with payments on) a payable host", () => {
    const host = readyHost;
    expect(isPubliclyBookable({ listing: { published: true, suspendedAt: null }, host, payoutsRequired: true })).toBe(true);
    expect(isPubliclyBookable({ listing: { published: false, suspendedAt: null }, host, payoutsRequired: true })).toBe(false);
    expect(isPubliclyBookable({ listing: { published: true, suspendedAt: new Date() }, host, payoutsRequired: true })).toBe(false);
    expect(
      isPubliclyBookable({ listing: { published: true, suspendedAt: null }, host: { ...host, stripeConnectChargesEnabled: false }, payoutsRequired: true }),
    ).toBe(false);
  });
});
