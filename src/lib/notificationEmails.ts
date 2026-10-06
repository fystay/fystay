import { getResendClient, EMAIL_FROM } from "@/lib/email";
import { formatPrice } from "@/lib/format";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { BASE_URL } from "@/lib/baseUrl";
import { escapeHtml, renderEmail, type EmailDetail } from "@/lib/emailLayout";

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
// (escapeHtml lives in emailLayout.ts, shared with the layout itself.)

function dateRange(checkIn: Date, checkOut: Date): string {
  return `${dateFormatter.format(checkIn)} – ${dateFormatter.format(checkOut)}`;
}

// Where a host's links go: their dashboard lists every booking and request.
// (ctx.bookingUrl is the guest's own booking page, which a host can't open.)
const HOST_DASHBOARD_URL = `${BASE_URL}/host/dashboard`;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The stay at a glance, for an email's details table. */
function stayDetails(ctx: BookingEmailContext, extra: EmailDetail[] = []): EmailDetail[] {
  return [
    { label: "Stay", value: ctx.listingTitle },
    { label: "Check-in", value: dateFormatter.format(ctx.checkIn) },
    { label: "Check-out", value: `${dateFormatter.format(ctx.checkOut)} (${plural(ctx.nights, "night")})` },
    { label: "Guests", value: String(ctx.guests) },
    ...extra,
    { label: "Booking reference", value: ctx.reference },
  ];
}

const greeting = (name: string | null) => `Hi ${escapeHtml(name ?? "there")},`;

/**
 * Sends both sides of a just-confirmed booking - the guest's confirmation and
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
        subject: `Booking confirmed: ${ctx.listingTitle}`,
        html: renderEmail({
          preheader: `${dateRange(ctx.checkIn, ctx.checkOut)} · ${formatPrice(ctx.totalPriceCents)} paid · ${ctx.reference}`,
          heading: "Your booking is confirmed",
          intro: `${greeting(ctx.guestName)} your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is booked and paid for - see you in ${escapeHtml(ctx.city)}.`,
          details: stayDetails(ctx, [{ label: "Total paid", value: formatPrice(ctx.totalPriceCents) }]),
          paragraphs: [
            `Your booking page has the address and check-in details from ${escapeHtml(ctx.hostName)}, a way to message them, and the cancellation policy for this stay. You'll also get a reminder a few days before you arrive.`,
          ],
          cta: { label: "View your booking", url: ctx.bookingUrl },
        }),
      }),
    );
  }

  sends.push(
    resend.emails.send({
      from: EMAIL_FROM,
      to: ctx.hostEmail,
      subject: `New booking: ${ctx.listingTitle}`,
      html: renderEmail({
        audience: "host",
        preheader: `${ctx.guestName ?? "A guest"} · ${dateRange(ctx.checkIn, ctx.checkOut)}`,
        heading: "You have a new booking",
        intro: `${greeting(ctx.hostName)} ${escapeHtml(ctx.guestName ?? "A guest")} has booked <strong>${escapeHtml(ctx.listingTitle)}</strong> and paid in full.`,
        details: stayDetails(ctx),
        paragraphs: ["Their contact details are on your dashboard, and they can message you through FYStay."],
        cta: { label: "Open your dashboard", url: HOST_DASHBOARD_URL },
      }),
    }),
  );

  await Promise.allSettled(sends);
}

/**
 * Sends both sides of a just-cancelled booking (by the guest, or by FYStay
 * support - so neither email says who). refundCents is whatever the
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
      ? `A refund of <strong>${formatPrice(refundCents)}</strong> is on its way to your original payment method. Refunds usually take 5-10 working days to show on your statement.`
      : "Under this stay's cancellation policy, no refund applies.";

  const sends: Promise<unknown>[] = [];

  if (ctx.guestEmail) {
    sends.push(
      resend.emails.send({
        from: EMAIL_FROM,
        to: ctx.guestEmail,
        subject: `Booking cancelled: ${ctx.listingTitle}`,
        html: renderEmail({
          preheader: refundCents > 0 ? `${formatPrice(refundCents)} refund on its way` : `Booking ${ctx.reference} cancelled`,
          heading: "Your booking is cancelled",
          intro: `${greeting(ctx.guestName)} your booking at <strong>${escapeHtml(ctx.listingTitle)}</strong> has been cancelled.`,
          details: stayDetails(ctx, refundCents > 0 ? [{ label: "Refund", value: formatPrice(refundCents) }] : []),
          paragraphs: [refundLine],
          cta: { label: "View your booking", url: ctx.bookingUrl },
        }),
      }),
    );
  }

  sends.push(
    resend.emails.send({
      from: EMAIL_FROM,
      to: ctx.hostEmail,
      subject: `Booking cancelled: ${ctx.listingTitle}`,
      html: renderEmail({
        audience: "host",
        preheader: `${dateRange(ctx.checkIn, ctx.checkOut)} is open again`,
        heading: "A booking was cancelled",
        intro: `${greeting(ctx.hostName)} the booking below for <strong>${escapeHtml(ctx.listingTitle)}</strong> has been cancelled, and those dates are open to book again.`,
        details: stayDetails(ctx),
        cta: { label: "Open your dashboard", url: HOST_DASHBOARD_URL },
      }),
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
    subject: `Booking request: ${ctx.listingTitle}`,
    html: renderEmail({
      audience: "host",
      preheader: `Reply within ${hoursToRespond} hours`,
      heading: "New booking request",
      intro: `${greeting(ctx.hostName)} ${escapeHtml(ctx.guestName ?? "A guest")} would like to book <strong>${escapeHtml(ctx.listingTitle)}</strong>.`,
      details: stayDetails(ctx, [{ label: "Total", value: formatPrice(ctx.totalPriceCents) }]),
      paragraphs: [
        `Please accept or decline within ${hoursToRespond} hours. If you don't, the request expires, the dates are released and the guest is told. They're only charged if you accept and they pay.`,
      ],
      cta: { label: "Review this request", url: HOST_DASHBOARD_URL },
    }),
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
      ? `Request approved: ${ctx.listingTitle}`
      : `Request not approved: ${ctx.listingTitle}`;
  const host = escapeHtml(ctx.hostName);
  const content =
    outcome === "approved"
      ? {
          heading: "Your request was approved",
          intro: `${greeting(ctx.guestName)} good news - ${host} approved your request. Pay now to confirm your stay; the dates are held for you for a short while.`,
          paragraphs: [`You haven't been charged yet. Your booking is confirmed once payment goes through.`],
          cta: { label: "Pay and confirm", url: ctx.bookingUrl },
        }
      : outcome === "declined"
        ? {
            heading: "Your request wasn't accepted",
            intro: `${greeting(ctx.guestName)} ${host} wasn't able to accept your request for these dates.`,
            paragraphs: ["You haven't been charged, and any credit you applied is back in your account."],
            cta: { label: "View details", url: ctx.bookingUrl },
          }
        : {
            heading: "Your request has expired",
            intro: `${greeting(ctx.guestName)} ${host} didn't reply in time, so this request has expired and the dates have been released.`,
            paragraphs: ["You haven't been charged, and any credit you applied is back in your account."],
            cta: { label: "View details", url: ctx.bookingUrl },
          };

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject,
    html: renderEmail({ preheader: `${ctx.listingTitle} · ${dateRange(ctx.checkIn, ctx.checkOut)}`, details: stayDetails(ctx), ...content }),
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
    subject: `Booking not completed: ${ctx.listingTitle}`,
    html: renderEmail({
      preheader: `${formatPrice(refundCents)} refunded in full`,
      heading: "We couldn't complete this booking",
      intro: `${greeting(ctx.guestName)} your payment came through after the hold on these dates had ended, and another guest had booked them in the meantime.`,
      details: stayDetails(ctx, [{ label: "Refunded", value: formatPrice(refundCents) }]),
      paragraphs: [
        `We've cancelled the booking and refunded <strong>${formatPrice(refundCents)}</strong> in full to your original payment method. Refunds usually take 5-10 working days to show on your statement.`,
        "We're sorry for the trouble - the property's page will show if other dates suit you.",
      ],
      cta: { label: "View details", url: ctx.bookingUrl },
    }),
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
    subject: `Action needed: authorize your security deposit for ${ctx.listingTitle}`,
    html: renderEmail({
      preheader: `A ${formatPrice(depositCents)} hold, not a charge`,
      heading: "Please authorise your security deposit",
      intro: `${greeting(ctx.guestName)} your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is coming up, and it has a refundable security deposit of ${formatPrice(depositCents)}.`,
      details: stayDetails(ctx, [{ label: "Deposit hold", value: formatPrice(depositCents) }]),
      paragraphs: [
        "This places a temporary hold on your card - it doesn't charge you. The hold is released automatically after your stay unless the host reports damage.",
      ],
      cta: { label: "Authorise the deposit", url: authorizeUrl },
    }),
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

  const arrival: EmailDetail[] = [
    ...(details.address ? [{ label: "Address", value: details.address }] : []),
    ...(details.checkInTime ? [{ label: "Check-in from", value: details.checkInTime }] : []),
    ...(details.wifiNetwork
      ? [{ label: "Wifi", value: `${details.wifiNetwork}${details.wifiPassword ? ` / ${details.wifiPassword}` : ""}` }]
      : []),
  ];

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject: `Your stay at ${ctx.listingTitle} is coming up`,
    html: renderEmail({
      preheader: `Check-in ${dateFormatter.format(ctx.checkIn)}${details.address ? ` · ${details.address}` : ""}`,
      heading: "Your stay is coming up",
      intro: `${greeting(ctx.guestName)} here's everything you need for your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong>.`,
      details: [...stayDetails(ctx), ...arrival],
      paragraphs: [
        ...(details.checkInInstructions
          ? [`<strong>Getting in:</strong> ${escapeHtml(details.checkInInstructions)}`]
          : []),
        `Need anything before you arrive? You can message ${escapeHtml(ctx.hostName)} from your booking page.`,
      ],
      cta: { label: "View your booking", url: ctx.bookingUrl },
    }),
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
    subject: `How was your stay at ${ctx.listingTitle}?`,
    html: renderEmail({
      preheader: "It takes a minute and helps the next guest choose",
      heading: "How was your stay?",
      intro: `${greeting(ctx.guestName)} thanks for staying at <strong>${escapeHtml(ctx.listingTitle)}</strong>. A short review helps other guests choose - and only guests who've stayed can leave one.`,
      details: stayDetails(ctx),
      cta: { label: "Leave a review", url: reviewUrl },
    }),
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
    html: renderEmail({
      preheader: `${transfer.providerName} airport transfers from ${formatPrice(transfer.priceCents)}`,
      heading: "Flying in? Your transfer can be sorted too",
      intro: `${greeting(ctx.guestName)} your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong> is booked. If you're arriving by air, you can add an airport transfer to the same booking.`,
      details: stayDetails(ctx, [{ label: "Transfer", value: `From ${formatPrice(transfer.priceCents)}` }]),
      paragraphs: [
        `${escapeHtml(transfer.providerName)}, a FYStay service partner, drives you door to door in a fully electric Tesla. You pay through FYStay - no separate account - and they contact you to confirm pickup times.`,
      ],
      cta: { label: "Add a transfer", url: transfer.transferUrl },
    }),
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
      ? `Your security deposit has been released: ${ctx.listingTitle}`
      : `Your security deposit was claimed: ${ctx.listingTitle}`;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.guestEmail,
    subject,
    html: renderEmail(
      outcome.outcome === "released"
        ? {
            preheader: "Nothing was claimed",
            heading: "Your deposit has been released",
            intro: `${greeting(ctx.guestName)} your ${formatPrice(outcome.depositCents)} security deposit hold has been released in full - nothing was claimed.`,
            details: stayDetails(ctx),
            paragraphs: ["Your bank may take a few days to remove the hold from your statement."],
            cta: { label: "View your booking", url: ctx.bookingUrl },
          }
        : {
            preheader: `${formatPrice(outcome.capturedCents)} claimed from your deposit`,
            heading: "Part of your deposit was claimed",
            intro: `${greeting(ctx.guestName)} ${escapeHtml(ctx.hostName)} claimed ${formatPrice(outcome.capturedCents)} of your ${formatPrice(outcome.depositCents)} security deposit. The reason they gave: "${escapeHtml(outcome.reason)}"`,
            details: stayDetails(ctx, [{ label: "Claimed", value: formatPrice(outcome.capturedCents) }]),
            paragraphs: [
              `If you think this is wrong, write to ${SUPPORT_EMAIL} with your booking reference and we'll look into it.`,
            ],
            cta: { label: "View your booking", url: ctx.bookingUrl },
          },
    ),
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
    html: renderEmail({
      audience: "partner",
      preheader: `${ctx.guestName ?? "A guest"} · ${dateRange(ctx.checkIn, ctx.checkOut)} · already paid`,
      heading: `New ${ctx.offeringName} booking`,
      intro: `Hi ${escapeHtml(ctx.providerName)}, a FYStay guest has booked and paid for <strong>${escapeHtml(ctx.offeringName)}</strong> (${formatPrice(ctx.priceCents)}).`,
      details: [
        { label: "Guest", value: ctx.guestName ?? "Not given" },
        { label: "Contact", value: ctx.guestEmail ?? "Not given" },
        { label: "Staying at", value: ctx.listingTitle },
        { label: "Dates", value: dateRange(ctx.checkIn, ctx.checkOut) },
      ],
      paragraphs: [
        ...(ctx.guestNotes ? [`<strong>Guest notes:</strong> ${escapeHtml(ctx.guestNotes)}`] : []),
        "Please contact the guest directly to confirm the pickup details.",
      ],
    }),
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
    html: renderEmail({
      preheader: `${ctx.providerName} will be in touch to confirm the details`,
      heading: `Your ${ctx.offeringName} is booked`,
      intro: `${greeting(ctx.guestName)} your <strong>${escapeHtml(ctx.offeringName)}</strong> is booked and paid for, as part of your stay at <strong>${escapeHtml(ctx.listingTitle)}</strong>.`,
      details: [
        { label: "Provided by", value: ctx.providerName },
        { label: "Your stay", value: dateRange(ctx.checkIn, ctx.checkOut) },
        { label: "Paid", value: formatPrice(ctx.priceCents) },
      ],
      paragraphs: [
        `${escapeHtml(ctx.providerName)} has your booking and will contact you directly to confirm pickup times. It's listed on your FYStay booking too.`,
      ],
      cta: { label: "View your booking", url: ctx.bookingUrl },
    }),
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

/**
 * A payment problem someone at FYStay has to act on - a refund made in the
 * Stripe Dashboard instead of through FYStay (so FYStay's own booking
 * record doesn't know about it), or a refund Stripe couldn't deliver to the
 * guest's card. Same inbox as chargebacks.
 */
export async function sendPaymentOpsAlertEmail(details: {
  subject: string;
  summary: string;
  amountCents: number;
  bookingReference: string | null;
  action: string;
  stripeUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend) return;

  await resend.emails.send({
    from: EMAIL_FROM,
    to: process.env.DISPUTE_ALERT_EMAIL || SUPPORT_EMAIL,
    subject: `${details.subject}: ${formatPrice(details.amountCents)}${details.bookingReference ? ` (booking ${details.bookingReference})` : ""}`,
    html: `
      <p>${escapeHtml(details.summary)}</p>
      <p><strong>Amount:</strong> ${formatPrice(details.amountCents)}<br>
      ${details.bookingReference ? `<strong>Booking:</strong> ${details.bookingReference}<br>` : ""}</p>
      <p><strong>What to do:</strong> ${escapeHtml(details.action)}</p>
      <p><a href="${details.stripeUrl}">Open it in Stripe</a></p>
    `,
  });
}

/**
 * Tells a host their paid Spotlight placement is booked in (see
 * src/lib/listingPromotions.ts) - sent once, when payment lands. Stripe
 * sends the payment receipt itself; this says what the money bought.
 */
export async function sendListingPromotionConfirmedEmail(ctx: {
  hostName: string;
  hostEmail: string;
  listingTitle: string;
  priceCents: number;
  startsAt: Date;
  endsAt: Date;
  manageUrl: string;
}): Promise<void> {
  const resend = getResendClient();
  if (!resend || !ctx.hostEmail) return;

  const startsNow = ctx.startsAt.getTime() <= Date.now() + 60_000;
  await resend.emails.send({
    from: EMAIL_FROM,
    to: ctx.hostEmail,
    subject: `Spotlight booked: ${ctx.listingTitle}`,
    html: renderEmail({
      audience: "host",
      preheader: startsNow ? "Live now on the homepage" : `Goes live ${dateFormatter.format(ctx.startsAt)}`,
      heading: "Your Spotlight placement is booked",
      intro: `${greeting(ctx.hostName)} thanks - <strong>${escapeHtml(ctx.listingTitle)}</strong> is booked into Spotlight stays on the FYStay homepage.`,
      details: [
        { label: "Listing", value: ctx.listingTitle },
        { label: startsNow ? "Live from" : "Goes live", value: startsNow ? "Now" : dateFormatter.format(ctx.startsAt) },
        { label: "Runs until", value: dateFormatter.format(ctx.endsAt) },
        { label: "Paid", value: formatPrice(ctx.priceCents) },
      ],
      paragraphs: ["Stripe has sent your payment receipt separately. You can see how often it's seen and clicked on your Spotlight page."],
      cta: { label: "See your Spotlight placements", url: ctx.manageUrl },
    }),
  });
}
