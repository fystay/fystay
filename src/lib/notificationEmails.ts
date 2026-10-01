import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { formatPrice } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/lib/seo";

const dateFormatter = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

/**
 * Everything every booking-lifecycle email needs, gathered once by the
 * caller (the Stripe webhook, the cancel route) rather than re-fetched here -
 * this file only builds and sends messages, it never queries the database
 * itself.
 */
export type BookingEmailContext = {
  reference: string;
  listingTitle: string;
  city: string;
  checkIn: Date;
  checkOut: Date;
  nights: number;
  guests: number;
  totalPriceCents: number;
  guestName: string | null;
  guestEmail: string | null;
  hostName: string;
  hostEmail: string;
  bookingUrl: string;
};

// Every email in this file is built from a mix of system-generated values
// (dates, prices, booking references) and free text a guest, host, or
// admin actually typed (a display name, a listing title, a cancellation
// reason, a note left for a provider) - the latter is interpolated
// directly into HTML sent to someone else, so it's escaped here rather
// than trusted, the same way any other HTML-templating layer would.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function dateRange(checkIn: Date, checkOut: Date): string {
  return `${dateFormatter.format(checkIn)} – ${dateFormatter.format(checkOut)}`;
}

function stayLine(ctx: BookingEmailContext): string {
  return `${dateRange(ctx.checkIn, ctx.checkOut)} (${ctx.nights} night${ctx.nights === 1 ? "" : "s"}, ${ctx.guests} guest${ctx.guests === 1 ? "" : "s"})`;
}

/**
 * Sends both sides of a just-confirmed booking - the guest's receipt and
 * the host's new-booking alert - or silently does nothing if Resend isn't
 * configured (e.g. local development), matching every other email send in
 * this app (see src/app/api/auth/forgot-password/route.ts). Failures are
 * swallowed rather than thrown: a booking that's already been paid for and
 * confirmed must never fail (or get rolled back) just because a
 * notification email didn't send.
 */
export async function sendBookingConfirmedEmails(ctx: BookingEmailContext): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  const sends: Promise<unknown>[] = [];

  if (ctx.guestEmail) {
    sends.push(
      resend.emails.send({
        from: EMAIL_FROM,
        to: ctx.guestEmail,
        subject: `Booking confirmed: ${escapeHtml(ctx.listingTitle)}`,
        html: `
          <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
          <p>Your booking is confirmed - see you in ${ctx.city}.</p>
          <p><strong>${escapeHtml(ctx.listingTitle)}</strong><br>
          ${stayLine(ctx)}<br>
          Total paid: ${formatPrice(ctx.totalPriceCents)}<br>
          Booking reference: ${ctx.reference}</p>
          <p><a href="${ctx.bookingUrl}">View your booking</a></p>
        `,
      }),
    );
  }

  sends.push(
    resend.emails.send({
      from: EMAIL_FROM,
      to: ctx.hostEmail,
      subject: `New booking: ${escapeHtml(ctx.listingTitle)}`,
      html: `
        <p>Hi ${escapeHtml(ctx.hostName)},</p>
        <p>You have a new confirmed booking for <strong>${escapeHtml(ctx.listingTitle)}</strong>.</p>
        <p>${stayLine(ctx)}<br>
        Booking reference: ${ctx.reference}</p>
        <p><a href="${ctx.bookingUrl}">View on your dashboard</a></p>
      `,
    }),
  );

  await Promise.allSettled(sends);
}

/**
 * Sends both sides of a just-cancelled booking. refundCents is whatever the
 * cancellation policy actually paid back (see src/lib/cancellationPolicy.ts)
 * - never assumed to be the full amount, and 0 is a valid, expected value
 * for a late cancellation under a strict policy.
 */
export async function sendBookingCancelledEmails(
  ctx: BookingEmailContext,
  refundCents: number,
): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  const refundLine =
    refundCents > 0
      ? `A refund of ${formatPrice(refundCents)} is on its way back to your original payment method.`
      : `Per the cancellation policy for this stay, no refund applies.`;

  const sends: Promise<unknown>[] = [];

  if (ctx.guestEmail) {
    sends.push(
      resend.emails.send({
        from: EMAIL_FROM,
        to: ctx.guestEmail,
        subject: `Booking cancelled: ${escapeHtml(ctx.listingTitle)}`,
        html: `
          <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
          <p>Your booking has been cancelled.</p>
          <p><strong>${escapeHtml(ctx.listingTitle)}</strong><br>
          ${stayLine(ctx)}<br>
          Booking reference: ${ctx.reference}</p>
          <p>${refundLine}</p>
          <p><a href="${ctx.bookingUrl}">View your booking</a></p>
        `,
      }),
    );
  }

  sends.push(
    resend.emails.send({
      from: EMAIL_FROM,
      to: ctx.hostEmail,
      subject: `Booking cancelled: ${escapeHtml(ctx.listingTitle)}`,
      html: `
        <p>Hi ${escapeHtml(ctx.hostName)},</p>
        <p>A guest has cancelled their booking for <strong>${escapeHtml(ctx.listingTitle)}</strong>, and those dates are open again.</p>
        <p>${stayLine(ctx)}<br>
        Booking reference: ${ctx.reference}</p>
        <p><a href="${ctx.bookingUrl}">View on your dashboard</a></p>
      `,
    }),
  );

  await Promise.allSettled(sends);
}

/**
 * Sent to the host the moment a guest submits a request-to-book request
 * (Listing.instantBook = false) - the host's card-free equivalent of
 * sendBookingConfirmedEmails' "new booking" alert, since nothing has been
 * charged yet for a request. hoursToRespond is REQUEST_HOLD_HOURS from
 * availability.ts, passed in rather than imported so this file keeps its
 * existing "just builds and sends messages" shape.
 */
export async function sendBookingRequestReceivedEmail(
  ctx: BookingEmailContext,
  hoursToRespond: number,
): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.hostEmail,
    subject: `Booking request: ${escapeHtml(ctx.listingTitle)}`,
    html: `
      <p>Hi ${escapeHtml(ctx.hostName)},</p>
      <p>${escapeHtml(ctx.guestName ?? "A guest")} would like to book <strong>${escapeHtml(ctx.listingTitle)}</strong>.</p>
      <p>${stayLine(ctx)}<br>
      Total: ${formatPrice(ctx.totalPriceCents)}</p>
      <p>Please respond within ${hoursToRespond} hours, or the request expires and the guest is notified automatically.</p>
      <p><a href="${ctx.bookingUrl}">Review this request</a></p>
    `,
  });
}

/**
 * Sent to the guest once their request-to-book request has been resolved,
 * one way or another. "approved" points them at the checkout link they
 * still need to complete (bookingUrl doubles as that link - see the
 * approve branch of /api/bookings/[id]/respond); "declined" and "expired"
 * both mean the same practical thing (no reservation, dates released) but
 * read very differently to a guest, so they're worded apart rather than
 * collapsed into one generic "not approved" message.
 */
export async function sendBookingRequestRespondedEmail(
  ctx: BookingEmailContext,
  outcome: "approved" | "declined" | "expired",
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  const subject =
    outcome === "approved"
      ? `Request approved: ${escapeHtml(ctx.listingTitle)}`
      : `Request not approved: ${escapeHtml(ctx.listingTitle)}`;
  const bodyLine =
    outcome === "approved"
      ? `Great news - ${escapeHtml(ctx.hostName)} approved your request. Complete payment to confirm your stay.`
      : outcome === "declined"
        ? `${escapeHtml(ctx.hostName)} wasn't able to accept your request for these dates.`
        : `${escapeHtml(ctx.hostName)} didn't respond in time, so this request has expired. Any credit you applied has been returned to your account.`;
  const linkLabel = outcome === "approved" ? "Complete your booking" : "View details";

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>${bodyLine}</p>
      <p><strong>${escapeHtml(ctx.listingTitle)}</strong><br>
      ${stayLine(ctx)}</p>
      <p><a href="${ctx.bookingUrl}">${linkLabel}</a></p>
    `,
  });
}

/**
 * Sent when a guest's payment arrives after their hold on the dates lapsed
 * and someone else booked them in the meantime - the booking is cancelled
 * and the payment refunded in full rather than double-booking the property.
 */
export async function sendBookingUnavailableRefundedEmail(
  ctx: BookingEmailContext,
  refundCents: number,
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `Booking not completed: ${escapeHtml(ctx.listingTitle)}`,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>Your payment came through after your hold on these dates had expired, and the dates had been booked by someone else in the meantime. We've cancelled this booking and refunded your payment of ${formatPrice(refundCents)} in full. Refunds usually reach your card within 5-10 working days.</p>
      <p><strong>${escapeHtml(ctx.listingTitle)}</strong><br>
      ${stayLine(ctx)}<br>
      Reference: ${escapeHtml(ctx.reference)}</p>
      <p>Sorry for the inconvenience. If you have any questions, contact us at ${SUPPORT_EMAIL}.</p>
    `,
  });
}

/**
 * Sent to the guest once their booking enters the security-deposit
 * authorization window (see needsDepositAuthorization in
 * securityDeposit.ts) - a real card hold, not a charge, so the wording is
 * explicit that nothing is being taken from them yet.
 */
export async function sendDepositAuthorizationRequestEmail(
  ctx: BookingEmailContext,
  depositCents: number,
  authorizeUrl: string,
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `Action needed: authorize your security deposit for ${escapeHtml(ctx.listingTitle)}`,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>Your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is coming up. This listing requires a
      refundable security deposit hold of ${formatPrice(depositCents)} - this places a hold on your
      card, it does not charge you. It's released automatically after your stay unless the host
      files a damage claim.</p>
      <p>${stayLine(ctx)}</p>
      <p><a href="${authorizeUrl}">Authorize your security deposit</a></p>
    `,
  });
}

/**
 * Sent to the guest a few days before check-in (see
 * ARRIVAL_REMINDER_WINDOW_DAYS in src/app/api/cron/booking-lifecycle-
 * emails/route.ts) - the address and check-in details a guest actually
 * needs to plan their arrival, surfaced proactively rather than only ever
 * available if they think to go back to their booking page. address/
 * checkInTime/checkInInstructions/wifi are each optional independently -
 * a host may have filled in some but not others.
 */
export async function sendArrivalReminderEmail(
  ctx: BookingEmailContext,
  details: {
    address: string | null;
    checkInTime: string | null;
    checkInInstructions: string | null;
    wifiNetwork: string | null;
    wifiPassword: string | null;
  },
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  const detailLines = [
    details.address && `<strong>Address:</strong> ${details.address}`,
    details.checkInTime && `<strong>Check-in:</strong> ${details.checkInTime}`,
    details.checkInInstructions && `<strong>Getting in:</strong> ${details.checkInInstructions}`,
    details.wifiNetwork &&
      `<strong>Wifi:</strong> ${details.wifiNetwork}${details.wifiPassword ? ` / ${details.wifiPassword}` : ""}`,
  ].filter(Boolean);

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `Your stay at ${escapeHtml(ctx.listingTitle)} is coming up`,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>Just a heads-up that your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is coming up.</p>
      <p>${stayLine(ctx)}<br>
      Booking reference: ${ctx.reference}</p>
      ${detailLines.length > 0 ? `<p>${detailLines.join("<br>")}</p>` : ""}
      <p><a href="${ctx.bookingUrl}">View your booking</a></p>
    `,
  });
}

/**
 * Sent to the guest once a stay has ended, inviting them to leave a review
 * (see REVIEW_REQUEST_DELAY_DAYS in src/app/api/cron/booking-lifecycle-
 * emails/route.ts) - the same review form already reachable from "My
 * trips", just surfaced proactively instead of relying on the guest to
 * come back and remember. reviewUrl points straight at that booking's card
 * on the trips page.
 */
export async function sendReviewRequestEmail(ctx: BookingEmailContext, reviewUrl: string): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `How was your stay at ${escapeHtml(ctx.listingTitle)}?`,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>We hope you had a great time at <strong>${escapeHtml(ctx.listingTitle)}</strong>. Other guests find your
      review genuinely useful when deciding where to stay - it only takes a minute.</p>
      <p>${stayLine(ctx)}<br>
      Booking reference: ${ctx.reference}</p>
      <p><a href="${reviewUrl}">Leave a review</a></p>
    `,
  });
}

/**
 * The post-booking upsell email (item 6 of the cross-sell brief in
 * docs/trip-extras-roadmap.md) - sent once per booking (see
 * needsTransferUpsellEmail in src/lib/bookingLifecycleEmails.ts) to a guest
 * who hasn't already added an airport transfer. `providerName`/
 * `offeringPriceCents` are passed in rather than hardcoded so this stays
 * correct if EV Exec's own name or price ever changes, and generic enough
 * to describe whichever provider is actually active for this category.
 */
export async function sendTransferUpsellEmail(
  ctx: BookingEmailContext,
  transfer: { providerName: string; priceCents: number; transferUrl: string },
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: "One less thing to arrange",
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>Your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is booked. If you're flying in, why not
      arrange your airport transfer at the same time?</p>
      <p>${escapeHtml(transfer.providerName)} provides premium Tesla transfers directly to your accommodation,
      from ${formatPrice(transfer.priceCents)}.</p>
      <p>${stayLine(ctx)}<br>
      Booking reference: ${ctx.reference}</p>
      <p><a href="${transfer.transferUrl}">Arrange my transfer</a></p>
    `,
  });
}

/**
 * Sent to the guest once a host has resolved an AUTHORIZED deposit hold -
 * either released (nothing claimed) or captured (a real charge for
 * something the host says went wrong, so the guest gets the reason, not
 * just the amount).
 */
export async function sendDepositResolvedEmail(
  ctx: BookingEmailContext,
  outcome:
    | { outcome: "released"; depositCents: number }
    | { outcome: "captured"; depositCents: number; capturedCents: number; reason: string },
): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  const subject =
    outcome.outcome === "released"
      ? `Your security deposit has been released: ${escapeHtml(ctx.listingTitle)}`
      : `Your security deposit was claimed: ${escapeHtml(ctx.listingTitle)}`;
  const bodyLine =
    outcome.outcome === "released"
      ? `Your ${formatPrice(outcome.depositCents)} security deposit hold has been released in full - nothing was claimed.`
      : `${escapeHtml(ctx.hostName)} claimed ${formatPrice(outcome.capturedCents)} of your ${formatPrice(outcome.depositCents)} security deposit. Reason given: "${escapeHtml(outcome.reason)}"`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>${bodyLine}</p>
      <p><strong>${escapeHtml(ctx.listingTitle)}</strong><br>
      ${stayLine(ctx)}</p>
      <p><a href="${ctx.bookingUrl}">View your booking</a></p>
    `,
  });
}

/**
 * Everything a Trip Extra purchase (see docs/trip-extras-roadmap.md) needs
 * to notify both sides - gathered once by the caller (the Stripe webhook)
 * rather than queried here, the same convention as BookingEmailContext.
 */
export type TripExtraEmailContext = {
  guestName: string | null;
  guestEmail: string | null;
  guestNotes: string | null;
  listingTitle: string;
  checkIn: Date;
  checkOut: Date;
  offeringName: string;
  priceCents: number;
  providerName: string;
  providerEmail: string;
  bookingUrl: string;
};

/**
 * Phase 1 fulfillment (see the roadmap's "Fulfillment" section): rather
 * than a real provider API, the provider gets a plain email with everything
 * their own booking form would have asked for. Never thrown on failure -
 * same reasoning as every other notification email here: a send failing
 * must never undo or block a payment that already succeeded.
 */
export async function sendTripExtraProviderEmail(ctx: TripExtraEmailContext): Promise<boolean> {
  const resend = getResendClient();
  if (!resend) return false;

  const { data, error } = await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.providerEmail,
    subject: `New booking request: ${ctx.offeringName}`,
    html: `
      <p>Hi ${escapeHtml(ctx.providerName)},</p>
      <p>FYStay has a new paid booking request for <strong>${ctx.offeringName}</strong>
      (${formatPrice(ctx.priceCents)}, already paid).</p>
      <p><strong>Guest:</strong> ${escapeHtml(ctx.guestName ?? "Not given")}<br>
      <strong>Contact:</strong> ${ctx.guestEmail ?? "Not given"}<br>
      <strong>Stay:</strong> ${escapeHtml(ctx.listingTitle)}, ${dateRange(ctx.checkIn, ctx.checkOut)}</p>
      ${ctx.guestNotes ? `<p><strong>Guest notes:</strong> ${escapeHtml(ctx.guestNotes)}</p>` : ""}
      <p>Please confirm this directly with the guest.</p>
    `,
  });

  return !error && Boolean(data);
}

/**
 * The guest's own receipt for a Trip Extra purchase - separate from
 * sendBookingConfirmedEmails since this is its own, later purchase against
 * an already-confirmed booking, not part of the original confirmation.
 */
export async function sendTripExtraGuestConfirmationEmail(ctx: TripExtraEmailContext): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.guestEmail) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `You're all set: ${ctx.offeringName}`,
    html: `
      <p>Hi ${escapeHtml(ctx.guestName ?? "there")},</p>
      <p>Your <strong>${ctx.offeringName}</strong> (${formatPrice(ctx.priceCents)}) is booked and paid for
      as part of your trip to <strong>${escapeHtml(ctx.listingTitle)}</strong>.</p>
      <p>${escapeHtml(ctx.providerName)} has been sent your booking request and will be in touch directly to confirm
      the details with you.</p>
      <p><a href="${ctx.bookingUrl}">View your booking</a></p>
    `,
  });
}

/**
 * Alerts whoever handles disputes that a bank-initiated chargeback just
 * came in (see PaymentDispute's own schema comment). Sent once per dispute
 * creation, from the Stripe webhook - never on every status update, since
 * a missed evidence deadline is what actually costs money and that only
 * happens once, at the start. DISPUTE_ALERT_EMAIL falls back to the same
 * public SUPPORT_EMAIL shown on /contact if a dedicated ops inbox hasn't
 * been configured yet - see docs/product-strategy.md on why this app
 * ships with a working fallback rather than waiting on a real credential.
 */
export async function sendDisputeAlertEmail(details: {
  amountCents: number;
  reason: string;
  evidenceDueBy: Date | null;
  bookingReference: string | null;
  disputeUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  const alertEmail = process.env.DISPUTE_ALERT_EMAIL || SUPPORT_EMAIL;
  const deadlineLine = details.evidenceDueBy
    ? `Evidence is due by <strong>${details.evidenceDueBy.toUTCString()}</strong> - after that, this dispute is an automatic loss.`
    : "Stripe has not given a response window for this dispute.";

  await resend.emails.send({
    from: EMAIL_FROM,
    to: alertEmail,
    subject: `New chargeback: ${formatPrice(details.amountCents)}${details.bookingReference ? ` (booking ${details.bookingReference})` : ""}`,
    html: `
      <p>A guest's bank has opened a dispute against a payment FYStay took.</p>
      <p><strong>Amount:</strong> ${formatPrice(details.amountCents)}<br>
      <strong>Reason given:</strong> ${escapeHtml(details.reason)}<br>
      ${details.bookingReference ? `<strong>Booking:</strong> ${details.bookingReference}<br>` : ""}</p>
      <p>${deadlineLine}</p>
      <p>Respond in the <a href="https://dashboard.stripe.com/disputes">Stripe dashboard</a> - this app
      doesn't submit evidence automatically. See it in FYStay's own admin panel:
      <a href="${details.disputeUrl}">${details.disputeUrl}</a></p>
    `,
  });
}
