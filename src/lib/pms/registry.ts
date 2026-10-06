import type { PmsProvider } from "@prisma/client";
import type { PmsAdapter } from "@/lib/pms/types";
import { cloudbedsAdapter } from "@/lib/pms/providers/cloudbeds";
import { siteminderAdapter } from "@/lib/pms/providers/siteminder";
import { supercontrolAdapter } from "@/lib/pms/providers/supercontrol";

/**
 * The one place that maps a PmsProvider to its adapter implementation.
 * Everything else in src/lib/pms/ and the API routes under
 * src/app/api/host/pms/ resolves an adapter through this function rather
 * than importing a provider file directly, so adding a real fourth
 * provider later is exactly two changes: a new file implementing
 * PmsAdapter, and one new entry here.
 */
const ADAPTERS: Record<PmsProvider, PmsAdapter> = {
  CLOUDBEDS: cloudbedsAdapter,
  SITEMINDER: siteminderAdapter,
  SUPERCONTROL: supercontrolAdapter,
};

export function getPmsAdapter(provider: PmsProvider): PmsAdapter {
  return ADAPTERS[provider];
}

/** Providers with a real (non-stub) implementation, for the "Connect" UI to show as actually connectable today rather than listing every enum value as equally ready. */
export const LIVE_PMS_PROVIDERS: PmsProvider[] = ["CLOUDBEDS"];

/** The app credentials each live provider needs before a host can connect - the same configuration-presence gate as every other integration. */
const PROVIDER_CONFIG_ENV: Partial<Record<PmsProvider, string[]>> = {
  CLOUDBEDS: ["CLOUDBEDS_CLIENT_ID", "CLOUDBEDS_CLIENT_SECRET"],
};

/** Whether a host can actually connect this provider here: implemented, and FYStay's own credentials for it are set. Otherwise the UI shows it as coming soon. */
export function isPmsProviderConnectable(provider: PmsProvider): boolean {
  if (!LIVE_PMS_PROVIDERS.includes(provider)) return false;
  return (PROVIDER_CONFIG_ENV[provider] ?? []).every((name) => Boolean(process.env[name]));
}

export const PMS_PROVIDER_LABEL: Record<PmsProvider, string> = {
  CLOUDBEDS: "Cloudbeds",
  SITEMINDER: "SiteMinder",
  SUPERCONTROL: "SuperControl",
};
