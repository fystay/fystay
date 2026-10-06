import { redirect } from "next/navigation";

/**
 * This used to be an optional "Complete your trip" step between reserving
 * a stay and paying for it. It only captured interest - its "Add airport
 * transfer" button led to the same checkout as "Skip", since a transfer can
 * only be bought once the stay is paid (see tripExtraPurchaseError) - so it
 * cost every guest an extra page and could leave them thinking a transfer
 * was booked when it wasn't. Reserving now goes straight to checkout, and
 * the transfer is offered where it can really be bought: the confirmation
 * page (AirportTransferNudge) and the booking page. Kept as a redirect for
 * any old link.
 */
export default async function TransferStepPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  redirect(`/checkout/${bookingId}`);
}
