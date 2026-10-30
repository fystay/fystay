import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, BedDouble, Check, MessageCircle, ShieldCheck } from "lucide-react";
import { ScrollUnderline } from "@/components/ScrollUnderline";
import { buttonVariants } from "@/components/ui/Button";
import { ShowcaseHeroImage } from "@/components/showcase/ShowcaseHeroImage";
import { ShowcaseGalleryStrip } from "@/components/showcase/ShowcaseGalleryStrip";
import { ShowcaseStickyBar } from "@/components/showcase/ShowcaseStickyBar";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import type { ShowcaseContent } from "@/lib/showcase/types";

function SectionTitle({ kicker, title, light = false }: { kicker: string; title: string; light?: boolean }) {
  return (
    <div>
      <p className={cn("text-xs font-semibold uppercase tracking-[0.2em]", light ? "text-brand-300" : "text-brand-700")}>{kicker}</p>
      <h2 className={cn("mt-2 max-w-2xl font-serif text-[1.9rem] font-bold leading-[1.1] sm:text-[2.4rem]", light ? "text-white" : "text-foreground")}>
        <span className="relative inline-block pb-2">
          {title}
          <ScrollUnderline />
        </span>
      </h2>
    </div>
  );
}

/**
 * A listing's own page: not a row in a list, but a page made for this
 * property - its headline, its photos told as a story (arriving, inside,
 * sleeping, after dark), the place around it, the people who look after it,
 * and one clear way to choose dates. FYStay's look throughout (cream and
 * terracotta, editorial frames); the property supplies the
 * content. `booking` is where the dates are chosen: the real booking widget
 * on a live listing.
 */
export function ListingShowcase({
  content,
  booking,
  contactHref,
  previewNote,
}: {
  content: ShowcaseContent;
  booking: ReactNode;
  contactHref: string;
  previewNote?: string;
}) {
  const { headline, price } = content;
  const priceLabel = `From ${formatPrice(price.fromCents)} a night`;

  return (
    <div className="flex-1">
      {previewNote && (
        <p role="status" className="bg-brand-50 px-6 py-2.5 text-center text-sm text-brand-900">
          {previewNote}
        </p>
      )}

      {/* The first screen, as on the homepage: the property's own photo edge
          to edge behind the headline, one way in. */}
      <section id="showcase-top" className="relative isolate">
        <ShowcaseHeroImage photo={content.hero} />
        <div className="mx-auto w-full max-w-6xl px-6 pb-56 pt-10 sm:pb-20 sm:pt-16 lg:pb-28 lg:pt-20">
          <div className="max-w-xl lg:max-w-2xl">
            <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-brand-700 sm:text-xs">
              <span aria-hidden className="h-[2px] w-8 rounded-full bg-brand-600" />
              {content.place}
            </p>
            <h1 className="mt-4 font-serif text-[2.4rem] font-bold leading-[1.04] tracking-[-0.01em] text-foreground sm:text-[3.2rem] lg:text-[4.1rem]">
              {headline.before}
              <span className="text-brand-600">{headline.accent}</span>
              {headline.after}
            </h1>
            <p className="mt-5 max-w-lg text-base leading-relaxed text-stone-800 sm:text-lg">{content.intro}</p>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a href="#book" className={cn(buttonVariants({ size: "lg" }), "px-7")}>
                Check availability
                <ArrowRight className="h-4 w-4" aria-hidden />
              </a>
              <a href="#photos" className={cn(buttonVariants({ variant: "outline", size: "lg" }), "hidden bg-surface/70 px-7 backdrop-blur sm:inline-flex")}>
                Take a look inside
              </a>
            </div>
            <p className="mt-4 text-sm text-stone-700">
              <span className="font-serif text-xl text-brand-800">{formatPrice(price.fromCents)}</span> a night
              {price.weekendCents ? ` · ${formatPrice(price.weekendCents)} Fri & Sat` : ""} · {price.minNights}-night minimum
            </p>
            <ul className="mt-4 hidden flex-col gap-2 text-sm text-stone-700 sm:flex">
              {["No booking fees", "Full price shown before you pay", content.hostNote].map((line) => (
                <li key={line} className="flex items-center gap-1.5">
                  <Check className="h-4 w-4 text-brand-600" aria-hidden />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* The rest of the photos, right under the hero. */}
      <ShowcaseGalleryStrip photos={content.gallery} />

      {/* The facts, at a glance. */}
      <section aria-label="At a glance" className="border-y border-border-subtle bg-surface-muted">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-y-4 px-6 py-5 sm:grid-cols-4">
          {content.facts.map((fact) => (
            <div key={fact.label} className="text-center sm:border-l sm:border-border-subtle sm:first:border-l-0">
              <dt className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500">{fact.label}</dt>
              <dd className="mt-1 font-serif text-xl text-foreground sm:text-2xl">{fact.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {content.inside && (
        <section id="inside" className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-10 sm:py-14">
          <SectionTitle kicker={content.inside.kicker} title={content.inside.title} />
          <p className="mt-3 max-w-2xl text-stone-700">{content.inside.body}</p>
        </section>
      )}

      {content.sleeping && (
        <section className="bg-surface-muted">
          <div className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
            <SectionTitle kicker={content.sleeping.kicker} title={content.sleeping.title} />
            {/* A swipeable row on a phone, three across from sm. */}
            <ul className="-mx-6 mt-6 flex scroll-px-6 snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
              {content.sleeping.rooms.map((room) => (
                <li key={room.name} className="w-[72vw] max-w-xs shrink-0 snap-start sm:w-auto sm:max-w-none">
                  <div className="relative aspect-[4/3] w-full overflow-hidden border-b-[3px] border-brand-500 shadow-[var(--shadow-card)] ring-1 ring-black/5">
                    <Image src={room.photo.src} alt={room.photo.alt} fill sizes="(min-width: 640px) 360px, 90vw" className="object-cover" />
                  </div>
                  <h3 className="mt-3 font-serif text-lg text-foreground">{room.name}</h3>
                  <p className="mt-1 flex items-center gap-2 text-sm text-stone-600">
                    <BedDouble className="h-4 w-4 text-brand-600" aria-hidden />
                    {room.beds}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {content.afterDark && (
        <section className="bg-ink text-white">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-8 px-6 py-10 sm:py-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionTitle kicker={content.afterDark.kicker} title={content.afterDark.title} light />
              <p className="mt-5 max-w-md text-white/80">{content.afterDark.body}</p>
            </div>
            <div className="grid grid-cols-2 items-start gap-4">
              {content.afterDark.photos.map((p, i) => (
                <div key={p.src} className={cn("relative aspect-[3/4] w-full overflow-hidden border-b-[3px] border-brand-500 ring-1 ring-white/10", i === 1 && "sm:mt-10")}>
                  <Image src={p.src} alt={p.alt} fill sizes="(min-width: 1024px) 280px, 45vw" className="object-cover" />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.setting && (
        <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
          <SectionTitle kicker={content.setting.kicker} title={content.setting.title} />
          <p className="mt-3 max-w-2xl text-stone-700">{content.setting.body}</p>
          <ul className="mt-6 grid gap-5 sm:grid-cols-3">
            {content.setting.points.map((point) => (
              <li key={point.title} className="border-t-[3px] border-brand-500 pt-4">
                <h3 className="font-serif text-xl text-foreground">{point.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-stone-600">{point.body}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="border-t border-border-subtle bg-surface-muted">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-6 py-10 sm:py-12 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="font-serif text-2xl font-bold text-foreground sm:text-3xl">What&apos;s here</h2>
            <ul className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm sm:text-base">
              {content.amenities.map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-stone-700">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-serif text-2xl font-bold text-foreground sm:text-3xl">Good to know</h2>
            <ul className="mt-4 flex flex-col gap-2.5 text-sm sm:text-base">
              {[...content.goodToKnow, price.cancellation].map((item) => (
                <li key={item} className="flex items-start gap-2.5 text-stone-700">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* The way in: the people who look after it, and the dates. */}
      <section id="book" className="scroll-mt-20 bg-brand-900 text-white">
        <div className="mx-auto grid w-full max-w-6xl items-start gap-8 px-6 py-10 sm:py-14 lg:grid-cols-5 lg:gap-14">
          <div className="lg:col-span-2">
            <h2 className="font-serif text-[1.9rem] font-bold leading-[1.1] sm:text-[2.4rem]">Book with the people who look after {content.title}</h2>
            <p className="mt-4 text-white/80">
              Choose your dates to see the full price, including every fee, and the payment schedule before you pay anything. Questions first? Ask the owners directly.
            </p>
            <Link
              href={contactHref}
              className="focus-ring mt-6 inline-flex h-12 items-center gap-2 rounded-xl border border-white/40 px-6 text-base font-semibold text-white hover:bg-white/10"
            >
              <MessageCircle className="h-4 w-4" aria-hidden />
              Message the owners
            </Link>
          </div>
          <div className="lg:col-span-3">{booking}</div>
        </div>
      </section>

      <ShowcaseStickyBar watchId="showcase-top" title={content.title} priceLabel={priceLabel} ctaLabel="Check availability" ctaHref="#book" />
    </div>
  );
}
