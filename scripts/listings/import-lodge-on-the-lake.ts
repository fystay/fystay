/**
 * Adds Lodge on the Lake to FYStay as a hidden, request-to-book listing
 * owned by an existing host account, with its photos uploaded to the same
 * Supabase Storage bucket a host's own uploads use.
 *
 *   DATABASE_URL="<target database>" \
 *   NEXT_PUBLIC_SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
 *   npm run listing:import-lodge -- --host-email owner@example.com [--confirm]
 *
 * The listing, its photos and the owner's own terms (rates, minimum stay,
 * cancellation and house rules) are in
 * src/lib/listingImports/lodgeOnTheLake.ts. Without --confirm it only
 * validates and says what it would do. It prints the
 * target database host (never the password). The listing is created
 * hidden; the owner reviews it at /host/listings and switches it to Live.
 * Running it twice for the same host is refused rather than duplicating.
 *
 * Local testing only: --photo-base-url http://localhost:3000/some/dir uses
 * already-served copies of the photos instead of uploading, and is refused
 * against any database that isn't on localhost.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { createListingSchema } from "../../src/lib/listingInput";
import { geocodeListing } from "../../src/lib/geocoding";
import { weekendRateError } from "../../src/lib/pricing";
import {
  LODGE_ON_THE_LAKE_PHOTOS,
  LODGE_ON_THE_LAKE_TITLE,
  buildLodgeOnTheLakeListing,
  LODGE_ON_THE_LAKE_OWNER_TERMS as terms,
} from "../../src/lib/listingImports/lodgeOnTheLake";

const PHOTO_DIR = path.join(__dirname, "lodge-on-the-lake", "photos");
const USAGE = "See the comment at the top of scripts/listings/import-lodge-on-the-lake.ts for usage.";

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--confirm");
  const hostEmail = flag(args, "host-email")?.trim().toLowerCase();
  const photoBaseUrl = flag(args, "photo-base-url");
  const url = process.env.DATABASE_URL;

  const problems: string[] = [];
  if (!url) problems.push("DATABASE_URL is not set");
  if (!hostEmail) problems.push("--host-email is required (the owner's existing FYStay host account)");
  if (problems.length > 0) {
    for (const problem of problems) console.error(`- ${problem}`);
    console.error(USAGE);
    process.exit(1);
  }

  const dbHost = new URL(url!).hostname;
  console.log(`Target database host: ${new URL(url!).host}`);
  if (photoBaseUrl && dbHost !== "localhost" && dbHost !== "127.0.0.1") {
    console.error("--photo-base-url is for local testing only; refusing against a non-local database.");
    process.exit(1);
  }

  // Validate the full input before touching anything, with stand-in photo
  // URLs of the right shape - the real ones only exist after upload.
  const draft = buildLodgeOnTheLakeListing(LODGE_ON_THE_LAKE_PHOTOS.map((p) => `https://example.invalid/${p.file}`));
  const validated = createListingSchema.safeParse(draft);
  if (!validated.success) {
    for (const issue of validated.error.issues) console.error(`- ${issue.path.join(".")}: ${issue.message}`);
    process.exit(1);
  }
  const weekendError = weekendRateError({
    pricePerNightCents: terms.pricePerNightCents,
    weekendPricePerNightCents: terms.weekendPricePerNightCents,
    propertyType: draft.propertyType,
  });
  if (weekendError) {
    console.error(`- ${weekendError}`);
    process.exit(1);
  }

  const prisma = new PrismaClient({ datasourceUrl: url });
  try {
    const host = await prisma.user.findUnique({
      where: { email: hostEmail },
      select: { id: true, role: true, deletedAt: true },
    });
    if (!host || host.deletedAt) {
      console.error(`Refused: no account for ${hostEmail}. The owner signs up and chooses "Become a host" first.`);
      process.exit(1);
    }
    if (host.role !== "HOST") {
      console.error(`Refused: ${hostEmail} is a ${host.role} account, not a host. They choose "Become a host" first.`);
      process.exit(1);
    }
    const existing = await prisma.listing.findFirst({
      where: { hostId: host.id, title: LODGE_ON_THE_LAKE_TITLE },
      select: { id: true },
    });
    if (existing) {
      console.error(`Refused: this host already has "${LODGE_ON_THE_LAKE_TITLE}" (listing ${existing.id}). Edit it at /host/listings instead.`);
      process.exit(1);
    }

    const pounds = (cents: number) => `£${(cents / 100).toFixed(2)}`;
    console.log(
      [
        `Would create "${LODGE_ON_THE_LAKE_TITLE}" for ${hostEmail}, hidden and request-to-book:`,
        `  ${pounds(terms.pricePerNightCents)} a night, ${pounds(terms.weekendPricePerNightCents)} on Fri/Sat nights, minimum ${terms.minNights} nights`,
        `  ${terms.cancellationPolicy.toLowerCase().replace("_", "-")} cancellation, smoking ${terms.smokingAllowed ? "allowed" : "not allowed"}, parties ${terms.partiesAllowed ? "allowed" : "not allowed"}`,
        `  ${LODGE_ON_THE_LAKE_PHOTOS.length} photos ${photoBaseUrl ? `from ${photoBaseUrl}` : "uploaded to listing-photos storage"}`,
      ].join("\n"),
    );
    if (!confirmed) {
      console.log("Dry run: nothing written. Re-run with --confirm to apply.");
      return;
    }

    let photoUrls: string[];
    if (photoBaseUrl) {
      photoUrls = LODGE_ON_THE_LAKE_PHOTOS.map((p) => `${photoBaseUrl.replace(/\/$/, "")}/${p.file}`);
    } else {
      // storage.ts is marked server-only; this script runs with the
      // react-server condition (see package.json) so it can reuse it.
      const { isStorageConfigured, uploadListingPhoto } = await import("../../src/lib/storage");
      if (!isStorageConfigured()) {
        console.error("Refused: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to upload photos.");
        process.exit(1);
      }
      photoUrls = [];
      for (const photo of LODGE_ON_THE_LAKE_PHOTOS) {
        const bytes = await readFile(path.join(PHOTO_DIR, photo.file));
        const result = await uploadListingPhoto(new File([bytes], photo.file, { type: "image/jpeg" }), host.id);
        if ("error" in result) {
          console.error(`Refused: uploading ${photo.file} failed (${result.error}). Nothing was written to the database.`);
          process.exit(1);
        }
        photoUrls.push(result.url);
        console.log(`  uploaded ${photo.file}`);
      }
    }

    // Not a hotel and no last-minute deal, so the parsed input is exactly
    // Listing's own columns.
    const { roomTypes, ...input } = createListingSchema.parse(buildLodgeOnTheLakeListing(photoUrls));
    if (roomTypes) throw new Error("Lodge on the Lake is not a hotel listing; it has no room types.");
    const listing = await prisma.listing.create({
      data: {
        ...input,
        pricePerNightCents: terms.pricePerNightCents,
        maxGuests: input.maxGuests!,
        bedrooms: input.bedrooms!,
        beds: input.beds!,
        bathrooms: input.bathrooms!,
        hostId: host.id,
        published: false,
      },
    });
    const coordinates = geocodeListing({ id: listing.id, city: listing.city });
    if (coordinates) await prisma.listing.update({ where: { id: listing.id }, data: coordinates });

    console.log(
      [
        `Created listing ${listing.id} (hidden).`,
        "Next: the owner signs in, opens /host/listings, checks every detail and photo, adds the Airbnb",
        "calendar link under Calendar sync, then switches the listing to Live.",
      ].join("\n"),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main();
