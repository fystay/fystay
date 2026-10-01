import { format } from "date-fns";
import { parseGuestParam, type GuestCounts } from "@/lib/search";

/**
 * The stay a guest searched for (dates + guests), carried from search
 * results onto a listing page so its booking widget opens with the same
 * selection - the same param names SearchBar writes (checkIn/checkOut as
 * yyyy-MM-dd, adults/children/infants/pets).
 */
export const STAY_QUERY_KEYS = ["checkIn", "checkOut", "adults", "children", "infants", "pets"] as const;

type RawParams = Record<string, string | string[] | undefined>;

const DATE_PARAM = /^\d{4}-\d{2}-\d{2}$/;

function single(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** "?checkIn=...&adults=..." with only the stay params that are set, or "" when none are. */
export function buildStayQuery(params: RawParams): string {
  const query = new URLSearchParams();
  for (const key of STAY_QUERY_KEYS) {
    const value = single(params[key]);
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : "";
}

export type StaySelection = {
  /** yyyy-MM-dd, or null when the dates were missing or not a usable future range. */
  checkIn: string | null;
  checkOut: string | null;
  guests: GuestCounts;
};

/**
 * Reads a stay selection back out of a listing page's query. Dates are only
 * kept as a pair, in order, and not in the past - anything else is dropped
 * rather than shown as a broken preselection, and the guest just picks
 * dates as normal.
 */
export function parseStaySelection(params: RawParams, today: Date = new Date()): StaySelection {
  const checkIn = single(params.checkIn);
  const checkOut = single(params.checkOut);
  const todayParam = format(today, "yyyy-MM-dd");
  const datesValid =
    !!checkIn &&
    !!checkOut &&
    DATE_PARAM.test(checkIn) &&
    DATE_PARAM.test(checkOut) &&
    !Number.isNaN(new Date(checkIn).getTime()) &&
    !Number.isNaN(new Date(checkOut).getTime()) &&
    checkIn >= todayParam &&
    checkOut > checkIn;

  return {
    checkIn: datesValid ? checkIn : null,
    checkOut: datesValid ? checkOut : null,
    guests: {
      adults: parseGuestParam(params.adults, 1) || 1,
      children: parseGuestParam(params.children, 0),
      infants: parseGuestParam(params.infants, 0),
      pets: parseGuestParam(params.pets, 0),
    },
  };
}
