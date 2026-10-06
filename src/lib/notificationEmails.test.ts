import { beforeEach, describe, expect, it, vi } from "vitest";

const send = vi.fn();
vi.mock("@/lib/email", () => ({
  EMAIL_FROM: "FYStay <test@fystay.dev>",
  getResendClient: () => ({ emails: { send } }),
}));

import {
  sendArrivalReminderEmail,
  sendBookingCancelledEmails,
  sendBookingConfirmedEmails,
  sendBookingRequestReceivedEmail,
} from "./notificationEmails";

const ctx = {
  reference: "FY-TEST1234",
  listingTitle: "Bed & Breakfast <Sea View>",
  city: "Lytham <b>",
  checkIn: new Date("2026-10-10T00:00:00Z"),
  checkOut: new Date("2026-10-12T00:00:00Z"),
  nights: 2,
  guests: 2,
  totalPriceCents: 22000,
  guestName: "Sam",
  guestEmail: "sam@example.com",
  hostName: "Alex",
  hostEmail: "alex@example.com",
  bookingUrl: "https://fystay.test/bookings/1",
};

beforeEach(() => send.mockReset());

describe("notification emails", () => {
  it("escapes host-entered arrival details in the HTML body", async () => {
    await sendArrivalReminderEmail(ctx, {
      address: '<a href="https://evil.test">Pay here</a>',
      checkInTime: "3pm",
      checkInInstructions: "<script>x</script>",
      wifiNetwork: "Net<1>",
      wifiPassword: "p&ss",
    });
    const { html } = send.mock.calls[0][0];
    expect(html).not.toContain('<a href="https://evil.test">');
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;a href=");
    expect(html).toContain("p&amp;ss");
  });

  it("keeps subjects as plain text and escapes the city in the body", async () => {
    await sendBookingConfirmedEmails(ctx);
    const guestEmail = send.mock.calls.find(([msg]) => msg.to === ctx.guestEmail)![0];
    expect(guestEmail.subject).toBe("Booking confirmed: Bed & Breakfast <Sea View>");
    expect(guestEmail.html).toContain("see you in Lytham &lt;b&gt;");
  });

  it("uses the FYStay design for every message: wordmark, heading and one button", async () => {
    await sendBookingConfirmedEmails(ctx);
    for (const [message] of send.mock.calls) {
      expect(message.html).toContain(">FY</span>");
      expect(message.html).toMatch(/<h1[^>]*>/);
      expect(message.html.match(/<a href="[^"]+" style="display:inline-block/g)).toHaveLength(1);
    }
  });

  it("links the guest to their booking and the host to their dashboard, never the guest's page", async () => {
    await sendBookingConfirmedEmails(ctx);
    const guest = send.mock.calls.find(([msg]) => msg.to === ctx.guestEmail)![0];
    const host = send.mock.calls.find(([msg]) => msg.to === ctx.hostEmail)![0];
    expect(guest.html).toContain(`href="${ctx.bookingUrl}"`);
    expect(host.html).not.toContain(ctx.bookingUrl);
    expect(host.html).toMatch(/href="[^"]*\/host\/dashboard"/);

    send.mockReset();
    await sendBookingRequestReceivedEmail(ctx, 24);
    expect(send.mock.calls[0][0].html).toMatch(/href="[^"]*\/host\/dashboard"/);
  });

  it("tells the guest the exact refund and when to expect it - or that none applies", async () => {
    await sendBookingCancelledEmails(ctx, 11000);
    const refunded = send.mock.calls.find(([msg]) => msg.to === ctx.guestEmail)![0];
    expect(refunded.html).toContain("£110");
    expect(refunded.html).toContain("5-10 working days");

    send.mockReset();
    await sendBookingCancelledEmails(ctx, 0);
    const none = send.mock.calls.find(([msg]) => msg.to === ctx.guestEmail)![0];
    expect(none.html).toContain("no refund applies");
    expect(none.html).not.toContain("working days");
  });
});

