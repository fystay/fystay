/**
 * The origin the browser SDK sends events to, taken from the public DSN
 * (https://<key>@<ingest host>/<project>), so the Content-Security-Policy's
 * connect-src can allow exactly that host and nothing else. Null when no DSN
 * is set or it can't be parsed - then nothing is added and the browser SDK
 * isn't running anyway (see src/instrumentation-client.ts).
 */
export function sentryIngestOrigin(dsn: string | undefined): string | null {
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" ? url.origin : null;
  } catch {
    return null;
  }
}
