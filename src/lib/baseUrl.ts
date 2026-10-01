/**
 * The site's own origin, for absolute links (emails, Stripe redirects,
 * canonical URLs, the sitemap). Trailing slashes are stripped so
 * `${BASE_URL}/path` never becomes `https://site//path` when the env value
 * was entered with one (as Production's was).
 */
export function normalizeBaseUrl(value: string | undefined): string {
  return (value?.trim() || "http://localhost:3000").replace(/\/+$/, "");
}

export const BASE_URL = normalizeBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
