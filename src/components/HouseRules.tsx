import {
  CalendarRange,
  Cigarette,
  CigaretteOff,
  Key,
  LogIn,
  LogOut,
  PartyPopper,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { formatListingTime, formatQuietHours } from "@/lib/listingTimes";

export type HouseRulesListing = {
  checkInTime: string | null;
  checkOutTime: string | null;
  selfCheckIn: boolean;
  minNights: number;
  maxNights: number | null;
  smokingAllowed: boolean;
  partiesAllowed: boolean;
  quietHoursStart: string | null;
  quietHoursEnd: string | null;
  additionalRules: string | null;
};

type Row = { icon: LucideIcon; text: string };

/**
 * Public rows only - never checkInInstructions/wifiNetwork/wifiPassword,
 * which stay guest-only and only appear once a booking is actually paid for
 * (see canSeeStayDetails on the booking detail page). Smoking and parties
 * always render a row either way, since "no smoking" is itself the rule a
 * guest needs to see, not just the absence of an amenity.
 */
function buildRows(listing: HouseRulesListing): Row[] {
  const rows: Row[] = [];

  if (listing.checkInTime) {
    rows.push({ icon: LogIn, text: `Check-in: ${formatListingTime(listing.checkInTime)}` });
  }
  if (listing.checkOutTime) {
    rows.push({ icon: LogOut, text: `Checkout: ${formatListingTime(listing.checkOutTime)}` });
  }
  if (listing.selfCheckIn) {
    rows.push({ icon: Key, text: "Self check-in with lockbox or keypad" });
  }

  const stayLength =
    listing.minNights > 1 && listing.maxNights !== null
      ? `${listing.minNights}–${listing.maxNights} night stay`
      : listing.minNights > 1
        ? `${listing.minNights} night minimum stay`
        : listing.maxNights !== null
          ? `${listing.maxNights} night maximum stay`
          : null;
  if (stayLength) {
    rows.push({ icon: CalendarRange, text: stayLength });
  }

  rows.push({
    icon: listing.smokingAllowed ? Cigarette : CigaretteOff,
    text: listing.smokingAllowed ? "Smoking allowed" : "No smoking",
  });
  rows.push({
    icon: PartyPopper,
    text: listing.partiesAllowed ? "Parties and events allowed" : "No parties or events",
  });

  if (listing.quietHoursStart && listing.quietHoursEnd) {
    rows.push({
      icon: Volume2,
      text: `Quiet hours: ${formatQuietHours(listing.quietHoursStart, listing.quietHoursEnd)}`,
    });
  }

  return rows;
}

export function HouseRules({ listing }: { listing: HouseRulesListing }) {
  const rows = buildRows(listing);

  return (
    <div className="mt-3 flex flex-col gap-4">
      <ul className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(({ icon: Icon, text }) => (
          <li key={text} className="flex items-center gap-3 text-sm text-stone-700">
            <Icon className="h-4.5 w-4.5 shrink-0 text-brand-600" aria-hidden />
            {text}
          </li>
        ))}
      </ul>
      {listing.additionalRules && (
        <p className="whitespace-pre-line rounded-xl bg-surface-muted px-4 py-3 text-sm text-stone-700">
          {listing.additionalRules}
        </p>
      )}
    </div>
  );
}
