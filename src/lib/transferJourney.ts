import { z } from "zod";

/** The shortest notice FYStay takes a standalone transfer on: the pickup must be at least this far ahead. */
export const MIN_TRANSFER_NOTICE_HOURS = 24;

const text = (label: string, max: number) =>
  z.string().trim().min(1, `Add the ${label}.`).max(max, `The ${label} is too long.`);

/**
 * What a guest tells us when buying an airport transfer without a stay.
 * `pickupAt` is the pickup date and time as a UTC ISO string (the form
 * converts the guest's local time); everything else is for the provider.
 */
export const transferJourneySchema = z.object({
  offeringId: z.string().min(1),
  pickupAddress: text("pickup address", 300),
  dropoffAddress: text("drop-off address", 300),
  pickupAt: z.string().datetime({ message: "Choose the pickup date and time." }),
  flightNumber: z.string().trim().max(20, "That flight number is too long.").optional(),
  passengers: z.number().int().min(1, "At least 1 passenger.").max(8, "For more than 8 passengers, contact us."),
  bags: z.number().int().min(0).max(20, "That's a lot of bags - contact us."),
  contactName: text("name", 100),
  contactPhone: z
    .string()
    .trim()
    .min(7, "Add a phone number the driver can reach you on.")
    .max(30, "That phone number is too long.")
    .regex(/^[+\d][\d\s()-]*$/, "Use digits only for the phone number."),
  notes: z.string().trim().max(1000, "Keep the notes under 1000 characters.").optional(),
});

export type TransferJourney = z.infer<typeof transferJourneySchema>;

/** Why this pickup time can't be taken, or null. */
export function transferTimeError(pickupAt: Date, now: Date = new Date()): string | null {
  const earliest = now.getTime() + MIN_TRANSFER_NOTICE_HOURS * 60 * 60 * 1000;
  return pickupAt.getTime() < earliest
    ? `Transfers need at least ${MIN_TRANSFER_NOTICE_HOURS} hours' notice. Choose a later pickup, or contact us.`
    : null;
}

/** The journey as the provider reads it (stored in BookingExtra.guestNotes). */
export function composeJourneyNotes(journey: TransferJourney): string {
  return [
    `Pickup: ${journey.pickupAddress}`,
    `Drop-off: ${journey.dropoffAddress}`,
    ...(journey.flightNumber ? [`Flight: ${journey.flightNumber}`] : []),
    `Passengers: ${journey.passengers}`,
    `Bags: ${journey.bags}`,
    ...(journey.notes ? [`Notes: ${journey.notes}`] : []),
  ].join("\n");
}
