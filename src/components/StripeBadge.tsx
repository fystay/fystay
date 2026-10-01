import { cn } from "@/lib/cn";

/**
 * Stripe's "S" mark (from Simple Icons, CC0) on Stripe's own brand colour,
 * labelled the way Stripe's brand guidelines ask partners to show it -
 * "Powered by Stripe" - so hosts can see payouts are handled by Stripe.
 */
export function StripeBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-xs font-medium text-stone-600",
        className,
      )}
    >
      <span className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[#635BFF]" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-3 w-3 fill-white">
          <path d="M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.594-7.305h.003z" />
        </svg>
      </span>
      Powered by <span className="font-semibold text-[#635BFF]">Stripe</span>
    </span>
  );
}
