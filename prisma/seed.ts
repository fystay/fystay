import { PrismaClient } from "@prisma/client";
import { seedDemoData } from "../src/lib/demoSeed";
import { isProductionSeedRefused } from "../src/lib/productionSeedGuard";

const prisma = new PrismaClient();

async function main() {
  // Same rule as /api/admin/seed-demo-data - see productionSeedGuard.ts.
  if (isProductionSeedRefused()) {
    console.error(
      "Refusing to seed: VERCEL_ENV=production. This would create demo accounts with " +
        "published test passwords and mark the mock hotel-affiliate provider ACTIVE in a real " +
        "production database. Set ALLOW_PRODUCTION_SEED=true if you specifically mean to do this.",
    );
    process.exit(1);
  }

  const summary = await seedDemoData(prisma);

  console.log("Seeded database:");
  console.log(`  host  -> ${summary.hostEmail} / hostpass123`);
  console.log(`  guest -> ${summary.guestEmail} / guestpass123`);
  console.log(`  ${summary.listingsCreated} listings created, ${summary.listingsSkippedExisting} already existed`);
  console.log(`  ${summary.reviewsCreated} completed stay(s) + review(s) created`);
  console.log(`  ${summary.extrasProvidersUpserted} trip-extras providers (EV Exec + 2 placeholders) + offerings upserted`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
