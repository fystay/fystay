import { prisma } from "@/lib/prisma";
import { BASE_URL } from "@/lib/baseUrl";
import { sendListingPromotionConfirmedEmail, sendListingPromotionRefundedEmail } from "@/lib/notificationEmails";

/**
 * Emails the host once a placement has just been activated (see
 * activatePaidPromotion). Shared by the Stripe webhook and the no-Stripe
 * development path, so both tell the host the same thing. Never throws: the
 * placement is already paid and live, and a failed email mustn't undo that
 * or make Stripe redeliver the event.
 */
export async function notifyListingPromotionActivated(promotionId: string): Promise<void> {
  try {
    const promotion = await prisma.listingPromotion.findUnique({
      where: { id: promotionId },
      select: {
        priceCents: true,
        startsAt: true,
        endsAt: true,
        listing: { select: { title: true } },
        host: { select: { name: true, email: true } },
      },
    });
    if (!promotion?.startsAt || !promotion.endsAt) return;
    await sendListingPromotionConfirmedEmail({
      hostName: promotion.host.name,
      hostEmail: promotion.host.email,
      listingTitle: promotion.listing.title,
      priceCents: promotion.priceCents,
      startsAt: promotion.startsAt,
      endsAt: promotion.endsAt,
      manageUrl: `${BASE_URL}/host/promote`,
    });
  } catch (error) {
    console.error("Couldn't send the Spotlight confirmation email", { promotionId, error });
  }
}

/**
 * Emails the host that their payment was refunded because the Spotlight row
 * filled up while they were paying. Never throws, for the same reason as
 * above: the refund has already been made.
 */
export async function notifyListingPromotionRefunded(promotionId: string): Promise<void> {
  try {
    const promotion = await prisma.listingPromotion.findUnique({
      where: { id: promotionId },
      select: {
        priceCents: true,
        listing: { select: { title: true } },
        host: { select: { name: true, email: true } },
      },
    });
    if (!promotion) return;
    await sendListingPromotionRefundedEmail({
      hostName: promotion.host.name,
      hostEmail: promotion.host.email,
      listingTitle: promotion.listing.title,
      priceCents: promotion.priceCents,
      manageUrl: `${BASE_URL}/host/promote`,
    });
  } catch (error) {
    console.error("Couldn't send the Spotlight refund email", { promotionId, error });
  }
}
