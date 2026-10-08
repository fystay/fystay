/**
 * Every Preview deployment says what it is, so the example stays and
 * reviews there are never mistaken for real properties, hosts or guests.
 * Never shown on the live site or a developer's machine.
 */
export function PreviewSiteBanner() {
  if (process.env.VERCEL_ENV !== "preview") return null;
  return (
    <div role="note" className="bg-stone-900 px-4 py-2 text-center text-xs font-medium text-white">
      Preview site: the stays, hosts and reviews here are examples for testing - not real properties or bookings.
    </div>
  );
}
