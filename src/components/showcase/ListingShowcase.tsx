import { isOptimizableImage } from "@/lib/image";
import type { ReactNode } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Bath,
  BedDouble,
  DoorOpen,
  MessageCircle,
  ShieldCheck,
  Users,
  Waves,
} from "lucide-react";
import { ScrollUnderline } from "@/components/ScrollUnderline";
import { buttonVariants } from "@/components/ui/Button";
import { ShowcaseGalleryStrip } from "@/components/showcase/ShowcaseGalleryStrip";
import { ShowcaseHeroImage } from "@/components/showcase/ShowcaseHeroImage";
import { ShowcaseMobileHero } from "@/components/showcase/ShowcaseMobileHero";
import { HeaderBookingPill } from "@/components/showcase/HeaderBookingPill";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/format";
import type { ShowcaseContent } from "@/lib/showcase/types";

const FACT_ICONS = {
  users: Users,
  door: DoorOpen,
  bath: Bath,
  bed: BedDouble,
  waves: Waves,
} as const;

function SectionTitle({
  kicker,
  title,
  light = false,
}: {
  kicker: string;
  title: string;
  light?: boolean;
}) {
  return (
    <div>
      <p
        className={cn(
          "text-xs font-semibold uppercase tracking-[0.2em]",
          light ? "text-brand-300" : "text-brand-700",
        )}
      >
        {kicker}
      </p>
      <h2
        className={cn(
          "mt-2 max-w-2xl font-serif text-[1.8rem] font-bold leading-[1.1] sm:text-[2.3rem]",
          light ? "text-white" : "text-foreground",
        )}
      >
        <span className="relative inline-block pb-2">
          {title}
          <ScrollUnderline />
        </span>
      </h2>
    </div>
  );
}

/**
 * A listing's own page, built to sell the place by what it looks like: the
 * photos lead (a big swipeable photo with the booking card over its foot on a
 * phone, the photo behind the headline on a bigger screen), the words are few
 * and plain, and the rest of the page is the property's photos told as a
 * story - the gallery, the bedrooms, after dark - then the place around it.
 * FYStay's look throughout (cream and terracotta, editorial frames); the
 * property supplies the content.
 *
 * `heroCard` is the dates-and-price card that rises over the phone photo;
 * `booking` is the full booking panel on a bigger screen. On a live listing
 * these are the real booking widget.
 */
export function ListingShowcase({
  content,
  heroCard,
  booking,
  contactHref,
  previewNote,
  heroWide = true,
  corner,
  bookingHref = "#book",
  bookingOnPhone = false,
  bookTitle,
  children,
}: {
  content: ShowcaseContent;
  /** The card that rises over the phone photo. */
  heroCard: ReactNode;
  /** The full booking panel at the foot of the page. */
  booking: ReactNode;
  contactHref?: string;
  previewNote?: string;
  /** False when the property's photos aren't big enough to fill a wide hero: bigger screens then keep the phone layout, centred. */
  heroWide?: boolean;
  /** Save and share buttons, over the photo. */
  corner?: ReactNode;
  /** Where "Check dates" in the header goes: the booking panel. */
  bookingHref?: string;
  /** Show the booking panel on a phone too (a live listing's widget is the only place dates are chosen). */
  bookingOnPhone?: boolean;
  bookTitle?: string;
  /** More of the page - description, host, map, reviews - between the facts and the booking panel. */
  children?: ReactNode;
}) {
  const { headline, price } = content;
  const priceLabel = `From ${formatPrice(price.fromCents)} a night`;

  return (
    <div className="flex-1">
      {previewNote && (
        <p
          role="status"
          className="bg-brand-50 px-6 py-2 text-center text-sm text-brand-900"
        >
          {previewNote}
        </p>
      )}

      {/* A phone: the photo first, the booking card over its foot, then the name. */}
      <section id="showcase-top" className={cn(heroWide && "sm:hidden")}>
        <ShowcaseMobileHero
          photos={content.carousel}
          title={{
            name: content.title,
            place: content.place,
            tagline:
              [headline.before, headline.accent, headline.after]
                .join("")
                .trim() || undefined,
          }}
          corner={corner}
          allSizes={!heroWide}
        />
        <div
          id="availability"
          className={cn(
            "relative z-10 -mt-14 scroll-mt-4 px-4",
            !heroWide && "sm:mx-auto sm:max-w-md",
          )}
        >
          {heroCard}
        </div>
        {/* The name, over the photo, is the page's h1; the host's line sits under it there. */}
        <h1 className="sr-only">{content.title}</h1>
      </section>

      {/* A bigger screen: as on the homepage, the photo edge to edge behind the headline. */}
      {heroWide && (
        <section
          id="showcase-top-wide"
          className="relative isolate hidden sm:block"
        >
          <ShowcaseHeroImage photo={content.hero} />
          {corner && (
            <div className="absolute right-6 top-6 z-10 flex items-center gap-2">
              {corner}
            </div>
          )}
          <div className="mx-auto w-full max-w-6xl px-6 pb-20 pt-16 lg:pb-28 lg:pt-20">
            <div className="max-w-xl lg:max-w-2xl">
              <h1 className="font-serif text-3xl font-bold leading-tight text-brand-800">
                {content.title}
              </h1>
              <p className="mt-1 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.22em] text-brand-700">
                <span
                  aria-hidden
                  className="h-[2px] w-8 rounded-full bg-brand-600"
                />
                {content.place}
              </p>
              {(headline.before || headline.accent) && (
                <h2 className="mt-5 font-serif text-[2.6rem] font-bold leading-[1.06] tracking-[-0.01em] text-foreground lg:text-[3.4rem]">
                  {headline.before}
                  <span className="text-brand-600">{headline.accent}</span>
                  {headline.after}
                </h2>
              )}
              {content.intro && (
                <p className="mt-5 max-w-lg text-lg leading-relaxed text-stone-800">
                  {content.intro}
                </p>
              )}
              <div
                id="hero-cta"
                className="mt-7 flex flex-wrap items-center gap-3"
              >
                <a
                  href="#book"
                  className={cn(buttonVariants({ size: "lg" }), "px-7")}
                >
                  Check availability
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
                <a
                  href="#photos"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "bg-surface/70 px-7 backdrop-blur",
                  )}
                >
                  See the photos
                </a>
              </div>
              <p className="mt-4 text-sm text-stone-700">
                <span className="font-serif text-xl text-brand-800">
                  {formatPrice(price.fromCents)}
                </span>{" "}
                a night
                {price.weekendCents
                  ? ` · ${formatPrice(price.weekendCents)} Fri & Sat`
                  : ""}{" "}
                · {price.minNights}-night minimum
              </p>
            </div>
          </div>
        </section>
      )}

      <ShowcaseGalleryStrip
        photos={content.gallery}
        startAt={
          content.hero && content.gallery[0]?.src === content.hero.src ? 1 : 0
        }
      />

      {/* The facts, at a glance. */}
      <section
        aria-label="At a glance"
        className="mt-4 border-y border-border-subtle bg-surface-muted"
      >
        <dl className="mx-auto grid max-w-6xl grid-cols-4 gap-2 px-4 py-4 sm:px-6 sm:py-5">
          {content.facts.map((fact) => {
            const Icon = FACT_ICONS[fact.icon ?? "door"];
            return (
              <div
                key={fact.label}
                className="flex flex-col items-center text-center"
              >
                <Icon className="h-5 w-5 text-brand-600" aria-hidden />
                <dd className="mt-1 font-serif text-base leading-tight text-foreground sm:text-xl">
                  {fact.value}
                </dd>
                <dt className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-stone-500">
                  {fact.label}
                </dt>
              </div>
            );
          })}
        </dl>
      </section>

      {content.sleeping && (
        <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
          <SectionTitle
            kicker={content.sleeping.kicker}
            title={content.sleeping.title}
          />
          {/* A swipeable row on a phone, three across from sm. */}
          <ul className="-mx-6 mt-6 flex scroll-px-6 snap-x snap-mandatory gap-4 overflow-x-auto px-6 pb-2 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-6 sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden">
            {content.sleeping.rooms.map((room) => (
              <li
                key={room.name}
                className="w-[78vw] max-w-xs shrink-0 snap-start sm:w-auto sm:max-w-none"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden border-b-[3px] border-brand-500 shadow-[var(--shadow-card)] ring-1 ring-black/5">
                  <Image
                    src={room.photo.src}
                    alt={room.photo.alt}
                    fill
                    unoptimized={!isOptimizableImage(room.photo.src)}
                    sizes="(min-width: 640px) 360px, 78vw"
                    className="object-cover"
                  />
                </div>
                <h3 className="mt-3 font-serif text-lg text-foreground">
                  {room.name}
                </h3>
                <p className="mt-0.5 flex items-center gap-2 text-sm text-stone-600">
                  <BedDouble className="h-4 w-4 text-brand-600" aria-hidden />
                  {room.beds}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {content.afterDark && (
        <section className="bg-ink text-white">
          <div className="mx-auto grid w-full max-w-6xl items-center gap-6 px-6 py-10 sm:py-14 lg:grid-cols-2 lg:gap-16">
            <div>
              <SectionTitle
                kicker={content.afterDark.kicker}
                title={content.afterDark.title}
                light
              />
              <p className="mt-3 max-w-md text-white/80">
                {content.afterDark.body}
              </p>
            </div>
            <div className="grid grid-cols-2 items-start gap-3 sm:gap-4">
              {content.afterDark.photos.map((p, i) => (
                <div
                  key={p.src}
                  className={cn(
                    "relative aspect-[3/4] w-full overflow-hidden border-b-[3px] border-brand-500 ring-1 ring-white/10",
                    i === 1 && "sm:mt-10",
                  )}
                >
                  <Image
                    src={p.src}
                    alt={p.alt}
                    fill
                    unoptimized={!isOptimizableImage(p.src)}
                    sizes="(min-width: 1024px) 280px, 45vw"
                    className="object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {content.setting && (
        <section className="mx-auto w-full max-w-6xl px-6 py-10 sm:py-14">
          <SectionTitle
            kicker={content.setting.kicker}
            title={content.setting.title}
          />
          <ul className="mt-6 grid gap-5 sm:grid-cols-3">
            {content.setting.points.map((point) => (
              <li
                key={point.title}
                className="border-t-[3px] border-brand-500 pt-3"
              >
                <h3 className="font-serif text-lg text-foreground">
                  {point.title}
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-stone-600">
                  {point.body}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {children}

      {(content.amenities.length > 0 ||
        content.goodToKnow.length > 0 ||
        content.price.cancellation) && (
        <section className="border-t border-border-subtle bg-surface-muted">
          <div className="mx-auto grid w-full max-w-6xl gap-6 px-6 py-8 sm:py-10 lg:grid-cols-2 lg:gap-16">
            <div>
              <h2 className="font-serif text-xl font-bold text-foreground sm:text-2xl">
                What&apos;s here
              </h2>
              <ul className="mt-3 flex flex-wrap gap-2">
                {content.amenities.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-border-subtle bg-surface px-3 py-1.5 text-sm text-stone-700"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-serif text-xl font-bold text-foreground sm:text-2xl">
                Good to know
              </h2>
              <ul className="mt-3 flex flex-col gap-2 text-sm text-stone-700 sm:text-base">
                {[...content.goodToKnow, price.cancellation].map((item) => (
                  <li key={item} className="flex items-start gap-2.5">
                    <ShieldCheck
                      className="mt-0.5 h-4 w-4 shrink-0 text-brand-600"
                      aria-hidden
                    />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>
      )}

      {/* The way in. On a phone the card at the top is the booking; here, a bigger screen has the full panel. */}
      <section id="book" className="scroll-mt-20 bg-brand-900 text-white">
        <div className="mx-auto grid w-full max-w-6xl items-start gap-6 px-6 py-10 sm:py-14 lg:grid-cols-5 lg:gap-14">
          <div className="lg:col-span-2">
            <h2 className="font-serif text-[1.7rem] font-bold leading-[1.1] sm:text-[2.2rem]">
              {bookTitle ??
                `Book with the people who look after ${content.title}`}
            </h2>
            <p className="mt-3 text-white/80">
              See the full price before you pay anything. Questions first? Ask
              the owners directly.
            </p>
            {contactHref && (
              <Link
                href={contactHref}
                className="focus-ring mt-5 inline-flex h-12 items-center gap-2 rounded-xl border border-white/40 px-6 text-base font-semibold text-white hover:bg-white/10"
              >
                <MessageCircle className="h-4 w-4" aria-hidden />
                Message the owners
              </Link>
            )}
          </div>
          <div
            className={cn(
              "lg:col-span-3",
              !bookingOnPhone && "hidden sm:block",
            )}
          >
            {booking}
          </div>
        </div>
      </section>

      <HeaderBookingPill
        watchIds={["availability", "hero-cta"]}
        pill={{
          title: priceLabel,
          subtitle: content.title,
          cta: "Check dates",
          href: bookingHref,
        }}
      />
    </div>
  );
}
