const OPTIMIZABLE_HOSTS = new Set(["images.unsplash.com"]);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
if (supabaseUrl) {
  try {
    OPTIMIZABLE_HOSTS.add(new URL(supabaseUrl).hostname);
  } catch {
    // ignore malformed env value
  }
}

// The site's own photos (public/images, and the hero's poster in
// public/videos). Only these folders, not any site-relative path: hosts can
// type a photo URL, and the optimizer shouldn't be pointed at other routes
// of this app.
const OPTIMIZABLE_LOCAL_PREFIXES = ["/images/", "/videos/"];

/**
 * next/image can only optimize the site's own files and remote hosts
 * declared in next.config.ts. Hosts type arbitrary photo URLs today, so we
 * optimize the ones we know about and fall back to an unoptimized <img> for
 * everything else rather than erroring at request time. Optimizing is what
 * resizes a photo for the space it's shown in - a 230px card on a phone gets
 * a small modern-format image, not the full-size original.
 */
export function isOptimizableImage(url: string): boolean {
  if (OPTIMIZABLE_LOCAL_PREFIXES.some((prefix) => url.startsWith(prefix)) && !url.includes("?")) return true;
  try {
    return OPTIMIZABLE_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
