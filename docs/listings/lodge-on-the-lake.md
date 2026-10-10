# Lodge on the Lake: adding it to FYStay

Written 10 October 2026. FYStay's first North West listing outside the Fylde
Coast, added through FYStay's own listing system (no separate site, no
hard-coded page).

## What's where

| Piece | File |
| --- | --- |
| Listing copy, facts, amenities, rules, photo order and alt text | `src/lib/listingImports/lodgeOnTheLake.ts` |
| Tests (validation, no unconfirmed claims, photos present) | `src/lib/listingImports/lodgeOnTheLake.test.ts` |
| One-off import script | `scripts/listings/import-lodge-on-the-lake.ts` (`npm run listing:import-lodge`) |
| The 17 gallery photos | `scripts/listings/lodge-on-the-lake/photos/` |
| Create-listing rules, now shared by the host API and the import | `src/lib/listingInput.ts` |

After the import, the listing is an ordinary row in the `Listing` table owned
by the owner's host account. Photos are in the Supabase `listing-photos`
bucket. The files above are not read by the running site again. **All later
edits happen in the host dashboard** (`/host/listings` → Edit) or by an admin
(`/admin/listings`): name, description, photos, amenities, rules, price, fees,
minimum stay, availability (Calendar, blocks, Airbnb calendar sync),
Live/Hidden, location and capacity.

## How it goes live

1. The owner creates a FYStay account and chooses **Become a host**.
2. Someone with production access runs the import with **the owner's own
   terms**. Nothing is defaulted, and the script refuses to run without them:

   ```sh
   DATABASE_URL="<production direct URL>" \
   NEXT_PUBLIC_SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
   npm run listing:import-lodge -- --host-email <owner's email> \
     --nightly-price <£> --min-nights <n> --cancellation-policy <flexible|moderate|strict> \
     --smoking-allowed <yes|no> --parties-allowed <yes|no> \
     [--cleaning-fee <£>] [--check-in "From 4pm"] [--check-out "By 10am"]
   ```

   Without `--confirm` it is a dry run that prints the target database host.
   Add `--confirm` to write. A second run for the same host is refused.
3. The listing is created **Hidden** and **request-to-book**: every request
   waits for the owner's approval before the guest is charged, so dates the
   owner hasn't confirmed can't be booked.
4. The owner opens `/host/listings`, checks everything, then:
   - pastes the **Airbnb export calendar link** under Calendar sync, so
     Airbnb bookings block FYStay dates (the lodge is still on Airbnb);
   - adds the lodge's street address (shown to guests only after booking);
   - connects payouts (Stripe Connect). Search hides listings whose host
     can't be paid once Stripe is live;
   - switches the listing to **Live**.

## Still to confirm with the owner

- **Nightly rate, fees, deposit, minimum stay, cancellation policy, smoking and
  party rules.** Not supplied; required at import.
- **Minimum stay.** The brief says "two nights per the property website", but
  the Lodge site's own facts register says that 2 is only a placeholder search
  default, not a confirmed rule.
- **Bed sizes.** Airbnb says two king beds; the Lodge site says doubles. The
  listing says king-size, per the brief. Owner to confirm.
- **Two bathrooms.** Only one is pictured.
- **"Waterfront" / "on the lake" wording.** Airbnb tags it waterfront; the
  Lodge site holds that claim back until the owner confirms. FYStay says "on a
  small lake" and "decking overlooking the water", but not "waterfront".
- **Fishing.** Airbnb says free for guests; FYStay only says it's available
  subject to village rules and a rod licence until confirmed.
- **Check-in/out times, pets, accessibility, quiet hours, safety devices.**
  Unknown; left unset, so nothing is shown.
- **Full amenities list.** Airbnb lists 55 but only 5 are readable. FYStay
  lists only what a source states or a photo plainly shows.
- **Living-room layout.** Two layouts appear in the owner's photos; only the
  media-wall layout is used.
- **Fire table** on the covered deck: pictured, not described, until confirmed.
- **Higher-resolution photos.** The supplied files are 720px on the long
  edge; originals would look sharper on large screens.
- **Leisure-village rules** for guests (passes, vehicles, quiet hours).

## Photos and rights

17 of the 21 photos the owner supplied, with permission, for the Lodge's own
site in October 2026 (recorded in `fystay/lsl-lodge`
`src/content/photos.ts`). **That permission covered the Lodge's own site. Get
the owner's written OK for FYStay too before going Live.** Not used: two
possibly-outdated living-room shots and two decorative close-ups. Nothing is
hotlinked from Airbnb.

## Reviews

Airbnb's 4.96 rating from 83 reviews is **not shown**. It belongs to Airbnb,
and FYStay shows only reviews from paid FYStay stays. The listing shows "New
on FYStay" until its first one.

## Known limits (existing FYStay behaviour, not changed in launch mode)

- **No map pin.** Carnforth isn't one of the mapped Fylde towns, and FYStay
  never guesses a location. The map view lists it under "outside the mapped
  towns".
- **No destination page.** `/destinations` and the homepage "Now covering"
  list are the six Fylde towns. A North West destination (e.g. "Carnforth &
  the Lake District edge") needs its own guide copy and photos. The homepage
  is frozen, so that is a post-launch decision.
- **Search** finds it by "Carnforth" (and by guest count, dates and
  amenities). A search for "Lancashire" or "Lake District" won't, because
  FYStay searches by town name only.
- **Gallery alt text** is generic ("<title> photo N"): FYStay stores photo
  URLs only. Descriptive alt text for each photo is kept in the content file
  for when per-photo alt text is supported.
- **12% commission.** FYStay's existing fee settings are unchanged. Whether
  FYStay can charge this host 10% + 2% is a separate commercial and payments
  change.
