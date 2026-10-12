# Admin-assisted host onboarding

FYStay prepares a listing → the host reviews and explicitly approves it →
FYStay checks it can go live → it goes live. Hosts can still create and
manage their own listings exactly as before; both kinds pass the same
publication checks.

Code: rules in `src/lib/listingReview.ts`, database side in
`src/lib/listingOnboarding.ts`. Migration:
`20261012130000_admin_assisted_listing_onboarding`.

## Lifecycle

| Stage | Stored as | Public? |
| --- | --- | --- |
| Draft | `reviewStatus = DRAFT` | No |
| Awaiting host review | `AWAITING_HOST_REVIEW` | No |
| Changes requested | `CHANGES_REQUESTED` (+ the host's note in the history) | No |
| Host approved | `HOST_APPROVED`, `approvedRevision`/`approvedAt`/`approvedById`/`approvedSnapshot` | No |
| Ready to publish | Host approved and no publication blockers | No |
| Live | `published = true` | Yes (if the host can be paid) |
| Suspended / withdrawn | `suspendedAt` / `published = false` after going live | No |

A host's own listing has `preparedById` and `reviewStatus` null: there is
nothing to approve. `materialRevision` counts changes to anything a guest
decides on (`MATERIAL_FIELDS`); small spelling, case or punctuation fixes
don't count. If FYStay changes something material after approval, the
listing goes back to the host (and comes down if it was live). The host's
own later edits are theirs and don't reset approval. Every step is recorded
in `ListingReviewEvent` (shown as History on the admin page).

## Why the schema changed

Before this, a listing only had `published` and `suspendedAt`; there was no
review status, revision or audit trail, and a listing always had a host
account. The migration adds: the review fields on `Listing` (all nullable or
defaulted, so existing listings are untouched), `HostInvitation` (an owner
who hasn't registered: name, email, optional phone, how they agreed to be
contacted, and a hashed one-time link) and `ListingReviewEvent`.

## Publication checks (every listing)

Not suspended · not held for an unaccepted invitation · host approved (FYStay-
prepared listings) · host account active and email confirmed · host payout-
ready wherever Stripe is configured (the same rule search uses) · title,
description, at least one photo, a nightly price and a town. Enforced on
the one publish path (`PATCH /api/listings/[id]`) and when a host creates a
listing (it's saved hidden, with the reason, if any check fails). All public
reads (search, homepage rows, deals, Spotlight, suggestions, sitemap,
destinations, llms.txt, listings API, availability, booking, messaging)
already require `published`.

## Using it

**Admin:** `/admin/properties` → **Add a property** → pick an existing host
or invite the owner (record how they agreed to be contacted) → fill in the
draft (it saves part-filled) → **Send invitation** (owners without an
account) → **Send for review** → when it says **Ready to publish**, **Publish
now**. The property page answers: who owns it, whether they have access,
where review is, what they asked to change, which revision they approved,
what's blocking it and whether it's live and searchable.

**Host:** the email link (or Hosting → Listings → **Review**) opens the
review page: every fact in plain words, **Preview as guests will see it**
(booking switched off), **Edit details**, **Calendar**, then **Approve this
version** (with a confirmation tick) or **Ask for changes**.

**Invitations:** only an account signed in with the invited address, once
that address is confirmed, can accept. Accepting turns hosting on and hands
over the draft; it approves nothing. Links last 14 days; sending again
replaces the old link. Without an email provider on a local machine, the
admin page shows the link instead of sending it.
