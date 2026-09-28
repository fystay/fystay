import { PrismaClient } from "@prisma/client";
import {
  assertNoProductionDatabaseOutsideProduction,
  BUILD_TIME_DATABASE_URL,
  isNextProductionBuild,
} from "@/lib/databaseIdentity";

// A preview deployment holding production credentials refuses to start here
// rather than connect - see src/lib/databaseIdentity.ts.
assertNoProductionDatabaseOutsideProduction();

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(isNextProductionBuild() ? { datasourceUrl: BUILD_TIME_DATABASE_URL } : undefined);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
