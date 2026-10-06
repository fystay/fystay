import type { PmsProvider } from "@prisma/client";

/**
 * The provider-agnostic contract every PMS/channel-manager integration
 * implements (see src/lib/pms/providers/*.ts). Nothing in src/lib/pms/sync.ts
 * or the API routes under src/app/api/host/pms/ ever imports a specific
 * provider's SDK or knows its endpoint shapes - they only ever call through
 * this interface, so adding a fourth provider later never touches the core
 * sync logic, only adds one more file implementing PmsAdapter and one line
 * in the registry (src/lib/pms/registry.ts).
 *
 * Direction of sync, matching how a PMS/channel manager actually works:
 * the PMS is the master of inventory, rates and restrictions (FYStay pulls
 * them in - see getAvailability/getRates/getRestrictions), while a booking
 * made *through FYStay* is what gets pushed out (createReservation) so the
 * PMS's own inventory count reflects it too. A reservation already on the
 * PMS's side (booked directly, or through another channel) is pulled in as
 * a blocking event via listReservations - it never becomes a FYStay
 * Booking, only an AvailabilityBlock (see src/lib/pms/sync.ts).
 */
export interface PmsAdapter {
  readonly provider: PmsProvider;

  /** "oauth2": connect via getAuthorizationUrl + exchangeCodeForCredentials. "api_key": connect via verifyApiKeyCredentials with host-entered values. */
  readonly authMethod: "oauth2" | "api_key";

  /** True if this provider can push near-real-time updates via webhook, in which case parseWebhookEvents/verifyWebhookSignature are implemented. False means this provider is polled only (the reconciliation cron is its only sync path). */
  readonly supportsWebhooks: boolean;

  // ---- OAuth2 connect flow (authMethod: "oauth2" only) ----

  /** Builds the provider's own OAuth consent-screen URL. `state` is an opaque, server-generated anti-CSRF token the callback route must verify matches what it issued. */
  getAuthorizationUrl?(params: { state: string; redirectUri: string }): string;

  /** Exchanges an OAuth authorization code for this provider's own credential shape (access/refresh tokens, whatever it needs) - stored encrypted via encryptPmsCredentials, never returned to the browser. */
  exchangeCodeForCredentials?(params: {
    code: string;
    redirectUri: string;
  }): Promise<{ credentials: unknown; expiresAt: Date | null }>;

  /** Refreshes an expired/expiring access token. Called proactively (see sync.ts's withValidCredentials) rather than only after a 401, since a mid-sync auth failure would otherwise abort a batch partway through. */
  refreshCredentials?(credentials: unknown): Promise<{ credentials: unknown; expiresAt: Date | null }>;

  // ---- API-key connect flow (authMethod: "api_key" only) ----

  /** Validates host-entered credentials (an API key/secret pair) by making one real, cheap authenticated call - never just checking the fields are non-empty. */
  verifyApiKeyCredentials?(credentials: unknown): Promise<{ ok: true } | { ok: false; error: string }>;

  // ---- Properties & rooms (pulled in, to drive the mapping UI) ----

  listProperties(credentials: unknown): Promise<PmsExternalProperty[]>;
  listRooms(credentials: unknown, externalPropertyId: string): Promise<PmsExternalRoom[]>;

  // ---- Inventory pulled FROM the PMS (it's the source of truth) ----

  getAvailability(
    credentials: unknown,
    externalPropertyId: string,
    externalRoomIds: string[],
    range: DateRange,
  ): Promise<PmsAvailabilityDay[]>;

  getRates(
    credentials: unknown,
    externalPropertyId: string,
    externalRoomIds: string[],
    range: DateRange,
  ): Promise<PmsRateDay[]>;

  getRestrictions(
    credentials: unknown,
    externalPropertyId: string,
    externalRoomIds: string[],
    range: DateRange,
  ): Promise<PmsRestrictionDay[]>;

  /** Reservations that exist on the PMS (or another channel it already aggregates) - pulled in as blocking AvailabilityBlocks, never as FYStay Bookings. `since` narrows to what's changed, when the provider supports it; omitted on a first/full sync. */
  listReservations(
    credentials: unknown,
    externalPropertyId: string,
    options: { since?: Date },
  ): Promise<PmsExternalReservation[]>;

  // ---- Pushed TO the PMS (a real FYStay booking) ----

  createReservation(
    credentials: unknown,
    externalPropertyId: string,
    input: PmsReservationInput,
  ): Promise<{ externalReservationId: string }>;

  cancelReservation(
    credentials: unknown,
    externalPropertyId: string,
    externalReservationId: string,
  ): Promise<void>;

  // ---- Webhooks (supportsWebhooks: true only) ----

  /** Checks the provider's own delivery signature (an HMAC header, a shared secret, whatever it uses) before the payload is trusted at all. */
  verifyWebhookSignature?(request: PmsWebhookRequest, connectionSecret: string): boolean;

  /** Normalizes a verified webhook body into one or more provider-agnostic events for src/lib/pms/sync.ts to act on. */
  parseWebhookEvents?(request: PmsWebhookRequest): PmsNormalizedWebhookEvent[];
}

export type DateRange = { from: Date; to: Date };

export type PmsExternalProperty = {
  externalPropertyId: string;
  name: string;
  address?: string | null;
};

export type PmsExternalRoom = {
  externalRoomId: string;
  externalPropertyId: string;
  name: string;
  maxOccupancy?: number | null;
};

export type PmsAvailabilityDay = {
  externalRoomId: string;
  date: Date;
  roomsAvailable: number;
};

export type PmsRateDay = {
  externalRoomId: string;
  date: Date;
  priceCents: number;
  currency: string;
};

export type PmsRestrictionDay = {
  externalRoomId: string;
  date: Date;
  minStayNights?: number | null;
  closedToArrival?: boolean;
  closedToDeparture?: boolean;
  /** True if the PMS has this room fully closed for sale on this date, independent of roomsAvailable (e.g. a maintenance block) - checked in addition to, not instead of, availability. */
  stopSell?: boolean;
};

export type PmsExternalReservation = {
  externalReservationId: string;
  externalRoomId: string;
  checkIn: Date;
  checkOut: Date;
  roomsBooked: number;
  status: "confirmed" | "cancelled";
  guestName?: string | null;
};

export type PmsReservationInput = {
  externalRoomId: string;
  checkIn: Date;
  checkOut: Date;
  roomsBooked: number;
  guestName: string;
  guestEmail: string | null;
  guestPhone: string | null;
  totalPriceCents: number;
  currency: string;
  /** FYStay's own booking reference, passed through so it's visible on the PMS side (e.g. as a reservation note) for a host reconciling the two systems by eye. */
  fystayBookingReference: string;
};

export type PmsWebhookRequest = {
  headers: Record<string, string>;
  rawBody: string;
};

export type PmsNormalizedWebhookEvent = {
  externalEventId: string;
  eventType: string;
  /** Set when this event is about a specific reservation (a change or cancellation) - lets sync.ts resolve it against PmsReservationLink/AvailabilityBlock without every event type needing its own handler shape. */
  externalReservationId?: string;
  externalPropertyId?: string;
};

/**
 * Thrown by an adapter to distinguish failure kinds the sync engine and
 * retry logic treat differently: `retryable` (a rate limit, a transient
 * network/5xx error - worth trying again) vs not (bad credentials, a
 * validation error the PMS rejected - retrying the exact same call would
 * just fail the same way, and the host needs to know instead).
 */
export class PmsAdapterError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(message: string, options: { retryable: boolean; statusCode?: number; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "PmsAdapterError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}

/**
 * What a host is told when a connected system (Cloudbeds etc.) fails: plain
 * words about what to do, never the provider's raw response, a status code
 * or a configuration variable name. The technical message is logged for
 * FYStay instead.
 */
export function pmsErrorForHost(error: unknown, fallback: string): string {
  console.error("Connected system error", error);
  if (!(error instanceof PmsAdapterError)) return fallback;
  const status = error.statusCode;
  if (status === 401 || status === 403) {
    return "The connection was refused. Please disconnect and connect your account again.";
  }
  if (error.retryable) {
    return "The connected system isn't responding right now. Please try again in a few minutes.";
  }
  if (status === undefined) {
    return "This connection isn't available yet. Please contact FYStay support if you need it.";
  }
  return fallback;
}
