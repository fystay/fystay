import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Search } from "lucide-react";
import { formatPrice } from "@/lib/format";
import { LODGE_ON_THE_LAKE_SHOWCASE } from "@/lib/showcase/lodgeOnTheLake";

export type PhoneStyle = "a" | "b" | "c";

const lodge = LODGE_ON_THE_LAKE_SHOWCASE;
// The sharpest portrait photo the lodge has: a phone's hero is portrait.
const PORTRAIT = lodge.carousel[0];
const HREF = "/showcase/lodge-on-the-lake";

function Chip({ light = false }: { light?: boolean }) {
  return (
    <p className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] ${light ? "bg-white/90 text-brand-800" : "bg-brand-50 text-brand-800"}`}>
      Spotlight stay <span aria-hidden>·</span> Promoted
    </p>
  );
}

function CompactSearch() {
  return (
    <div className="flex items-center gap-2.5 rounded-full border border-border-subtle bg-surface py-2 pl-5 pr-2 shadow-[var(--shadow-popover)]">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">Where to?</span>
        <span className="block text-xs text-stone-500">Any dates · 1 guest</span>
      </span>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white">
        <Search className="h-4 w-4" aria-hidden />
      </span>
    </div>
  );
}

/**
 * Three ways a phone's homepage hero could show a Spotlight stay (a mock-up
 * - see ./page.tsx). All use the lodge's portrait photo at full strength:
 * a: the photo fills the screen, white text on a dark foot, a solid button,
 *    and the full search card over it;
 * b: the name and price on cream above the photo, the search card rising
 *    over the photo's foot (like a listing page);
 * c: as a, with the search folded into one slim bar so more photo shows.
 */
export function PhoneHeroVariant({ style, fullSearch }: { style: PhoneStyle; fullSearch: React.ReactNode }) {
  if (style === "b") {
    return (
      <div className="sm:hidden">
        <div className="px-6 pb-4 pt-5">
          <Chip />
          <h1 className="mt-3 font-serif text-[2.2rem] font-bold leading-[1.05] text-foreground">{lodge.title}</h1>
          <Link href={HREF} className="mt-2 inline-flex items-center gap-1.5 text-base font-semibold text-brand-700">
            Carnforth · From {formatPrice(lodge.price.fromCents)} a night <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <div className="relative aspect-[4/5] w-full">
          <Image src={PORTRAIT.src} alt={PORTRAIT.alt} fill priority sizes="100vw" className="object-cover" />
        </div>
        <div className="relative z-10 -mt-14 px-4 pb-4">{fullSearch}</div>
      </div>
    );
  }

  return (
    <div className="relative isolate flex min-h-[calc(100svh-150px)] flex-col justify-end sm:hidden">
      <Image src={PORTRAIT.src} alt={PORTRAIT.alt} fill priority sizes="100vw" className="-z-10 object-cover" />
      <div aria-hidden className="absolute inset-0 -z-10 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
      <div className="px-5 pb-5 text-white">
        <Chip light />
        <h1 className="mt-3 font-serif text-[2.4rem] font-bold leading-[1.04] [text-shadow:0_1px_14px_rgba(0,0,0,0.4)]">{lodge.title}</h1>
        <p className="mt-1.5 text-base text-white/90">Carnforth · From {formatPrice(lodge.price.fromCents)} a night</p>
        <Link href={HREF} className="mt-4 inline-flex h-12 items-center gap-2 rounded-xl bg-white px-6 text-base font-semibold text-brand-800 shadow-md">
          View this stay <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
      <div className="px-4 pb-4">{style === "c" ? <CompactSearch /> : fullSearch}</div>
    </div>
  );
}
