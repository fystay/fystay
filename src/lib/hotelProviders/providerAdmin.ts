import type { PrismaClient } from "@prisma/client";
import {
  FIXTURE_HOTEL_PROVIDER_CODES,
  LIVE_HOTEL_PROVIDER_CODES,
  defaultActivationContext,
  evaluateProviderActivation,
  listRegisteredHotelProviders,
} from "@/lib/hotelProviders/registry";

/**
 * Operator tooling for HotelProvider rows - the logic behind
 * prisma/hotel-provider.ts (a local CLI run with the target database's own
 * credentials, deliberately not an HTTP endpoint or admin page: there is no
 * public surface to attack, and changing which providers serve traffic
 * needs direct database access in the first place).
 *
 * What it can do is intentionally narrow:
 *   - list: every registered adapter and database row, with the activation
 *     decision shown for BOTH non-production and production, since the tool
 *     can't know which deployment a given database serves.
 *   - create: registered codes only, always INACTIVE, with name and
 *     capability flags copied from the adapter itself so the row can't drift
 *     from what the code actually supports.
 *   - set-status: ACTIVE / INACTIVE / COMING_SOON on an existing row.
 * Every write is a dry run unless --apply is given, and --apply also needs
 * --confirm-host naming the database host being written to, so a production
 * DATABASE_URL left in a shell can't be changed by accident. There is no
 * delete and no way to edit capability flags.
 *
 * None of this can make a provider operational on its own:
 * LIVE_HOTEL_PROVIDER_CODES is a frozen constant in registry.ts, so an
 * external provider still needs a code change and deploy after its row is
 * ACTIVE - which is exactly what the printed decisions show.
 */

export const HOTEL_PROVIDER_STATUSES = ["ACTIVE", "INACTIVE", "COMING_SOON"] as const;
export type HotelProviderStatusValue = (typeof HOTEL_PROVIDER_STATUSES)[number];

type ProviderDb = Pick<PrismaClient, "hotelProvider">;

export type DatabaseTarget = { host: string; port: string; database: string };

export type AdminResult = { ok: true; lines: string[] } | { ok: false; lines: string[]; error: string };

export type WriteOptions = { apply: boolean; confirmHost?: string; target: DatabaseTarget };

/** Host/port/database only - the username and password in the URL are never read out, printed or returned. */
export function describeDatabaseTarget(databaseUrl: string | undefined): DatabaseTarget | null {
  if (!databaseUrl) return null;
  try {
    const url = new URL(databaseUrl);
    return { host: url.hostname, port: url.port || "5432", database: url.pathname.replace(/^\//, "") || "(default)" };
  } catch {
    return null;
  }
}

export function formatDatabaseTarget(target: DatabaseTarget): string {
  return `${target.host}:${target.port}/${target.database}`;
}

function describeDecision(code: string, status: string, isProduction: boolean): string {
  const decision = evaluateProviderActivation(
    { code, status },
    { ...defaultActivationContext({}), isProduction },
  );
  return decision.operational ? "operational" : `not operational (${decision.reason})`;
}

function decisionLines(code: string, status: string): string[] {
  return [
    `  non-production: ${describeDecision(code, status, false)}`,
    `  production:     ${describeDecision(code, status, true)}`,
  ];
}

export type ProviderOverviewRow = {
  code: string;
  registered: boolean;
  dbStatus: string | null;
  fixture: boolean;
  liveListed: boolean;
  nonProduction: string;
  production: string;
};

export async function listProviderOverview(db: ProviderDb): Promise<ProviderOverviewRow[]> {
  const registered = listRegisteredHotelProviders();
  const rows = await db.hotelProvider.findMany({ select: { code: true, status: true }, orderBy: { code: "asc" } });
  const statusByCode = new Map(rows.map((row) => [row.code, row.status as string]));
  const codes = [...new Set([...registered.map((p) => p.code), ...rows.map((row) => row.code)])].sort();

  return codes.map((code) => {
    const dbStatus = statusByCode.get(code) ?? null;
    return {
      code,
      registered: registered.some((p) => p.code === code),
      dbStatus,
      fixture: FIXTURE_HOTEL_PROVIDER_CODES.includes(code),
      liveListed: LIVE_HOTEL_PROVIDER_CODES.includes(code),
      nonProduction: dbStatus === null ? "no database row" : describeDecision(code, dbStatus, false),
      production: dbStatus === null ? "no database row" : describeDecision(code, dbStatus, true),
    };
  });
}

/** Returns an error result unless this is an --apply run whose --confirm-host matches the real target host. */
function writeRefusal(options: WriteOptions, lines: string[]): AdminResult | null {
  if (!options.apply) {
    lines.push("Dry run - nothing was written. Re-run with --apply --confirm-host=<database host> to make this change.");
    return { ok: true, lines };
  }
  if (!options.target.host || options.confirmHost !== options.target.host) {
    return {
      ok: false,
      lines,
      error: `Refusing to write: --confirm-host must exactly match the database host "${options.target.host}".`,
    };
  }
  return null;
}

export async function createProviderRow(db: ProviderDb, code: string, options: WriteOptions): Promise<AdminResult> {
  const adapter = listRegisteredHotelProviders().find((p) => p.code === code);
  if (!adapter) {
    return { ok: false, lines: [], error: `"${code}" is not a registered hotel provider - rows can only be created for codes in registry.ts.` };
  }
  const existing = await db.hotelProvider.findUnique({ where: { code }, select: { status: true } });
  if (existing) {
    return { ok: false, lines: [], error: `A "${code}" row already exists (status ${existing.status}). Use set-status to change it.` };
  }

  const lines = [
    `Target database: ${formatDatabaseTarget(options.target)}`,
    `Create "${code}" (${adapter.name}) with status INACTIVE and the adapter's own capability flags:`,
    `  search=${adapter.supportsSearch} deepLink=${adapter.supportsDeepLink} clickTracking=${adapter.supportsClickTracking} conversionTracking=${adapter.supportsConversionTracking}`,
  ];
  const refusal = writeRefusal(options, lines);
  if (refusal) return refusal;

  await db.hotelProvider.create({
    data: {
      code: adapter.code,
      name: adapter.name,
      status: "INACTIVE",
      supportsSearch: adapter.supportsSearch,
      supportsDeepLink: adapter.supportsDeepLink,
      supportsClickTracking: adapter.supportsClickTracking,
      supportsConversionTracking: adapter.supportsConversionTracking,
    },
  });
  lines.push(`Created "${code}" as INACTIVE.`);
  return { ok: true, lines };
}

export async function setProviderStatus(
  db: ProviderDb,
  code: string,
  status: string,
  options: WriteOptions,
): Promise<AdminResult> {
  if (!(HOTEL_PROVIDER_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, lines: [], error: `Status must be one of ${HOTEL_PROVIDER_STATUSES.join(", ")}.` };
  }
  if (!listRegisteredHotelProviders().some((p) => p.code === code)) {
    return { ok: false, lines: [], error: `"${code}" is not a registered hotel provider.` };
  }
  const existing = await db.hotelProvider.findUnique({ where: { code }, select: { status: true } });
  if (!existing) {
    return { ok: false, lines: [], error: `No "${code}" row exists. Create it first (it starts INACTIVE).` };
  }
  if (existing.status === status) {
    return { ok: true, lines: [`"${code}" is already ${status} - nothing to change.`] };
  }

  const lines = [
    `Target database: ${formatDatabaseTarget(options.target)}`,
    `Change "${code}" from ${existing.status} to ${status}. Resulting activation decision:`,
    ...decisionLines(code, status),
  ];
  if (status === "ACTIVE" && !FIXTURE_HOTEL_PROVIDER_CODES.includes(code) && !LIVE_HOTEL_PROVIDER_CODES.includes(code)) {
    lines.push(
      `  Note: "${code}" is not in LIVE_HOTEL_PROVIDER_CODES, so it stays non-operational everywhere until that code change is deployed.`,
    );
  }
  if (status === "ACTIVE" && FIXTURE_HOTEL_PROVIDER_CODES.includes(code)) {
    lines.push(`  Note: "${code}" serves fixture data and is never operational on a production deployment.`);
  }
  const refusal = writeRefusal(options, lines);
  if (refusal) return refusal;

  await db.hotelProvider.update({ where: { code }, data: { status: status as HotelProviderStatusValue } });
  lines.push(`Updated "${code}" to ${status}.`);
  return { ok: true, lines };
}
