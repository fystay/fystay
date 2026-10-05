import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { isOptimizableImage } from "@/lib/image";
import type { PartnerService } from "@/lib/partnerServices";

/**
 * The image area of a large card: a real photo, or FYStay's own art where no
 * real photo exists - a brand gradient, or ("quiet") a calm warm-neutral
 * panel with the icon on a raised disc, for cards that sit beside photos and
 * shouldn't shout over them.
 */
export type LargeCardImage =
  | { photoSrc: string }
  | { icon: LucideIcon; gradient: string }
  | { icon: LucideIcon; tone: "quiet" };

/**
 * A large, image-led card for LargeCardRail: a big rounded image area with
 * a short title and one line of description beneath it. The whole card is
 * one link. Image ratio is 1:1 on phones and 4:3 from sm up, so the card
 * stays substantial without towering over the page on desktop.
 */
export function LargeCard({
  href,
  image,
  eyebrow,
  title,
  description,
  meta,
  onClick,
}: {
  href: string;
  image: LargeCardImage;
  eyebrow?: string;
  title: string;
  description?: string;
  /** A short trailing detail, e.g. "3 stays to explore" or a price. */
  meta?: string;
  onClick?: () => void;
}) {
  return (
    <Link href={href} onClick={onClick} className="focus-ring group block rounded-[22px]">
      <LargeCardImageArea image={image} />
      <div className="px-1 pt-4">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{eyebrow}</p>
        )}
        <p className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-brand-800 sm:text-lg">
          {title}
        </p>
        {description && <p className="mt-1 line-clamp-2 text-sm text-stone-500">{description}</p>}
        {meta && <p className="mt-2 text-sm font-medium text-brand-700">{meta}</p>}
      </div>
    </Link>
  );
}

/**
 * A LargeCard for a service FYStay offers through an independent provider
 * (see src/lib/partnerServices.ts): the same card shape, spacing and type
 * as every other large card. The provider's identity leads, on the image:
 * its own logo when supplied, its name, and the relationship ("FYStay
 * service partner") as one unit. Beneath: what it offers, then the price
 * and what it buys beside a "Book with <provider>" call to action, so the
 * offer reads in full without opening it. The image area shows the
 * provider's own photo when supplied, otherwise a plain backdrop - never a
 * stand-in vehicle or a drawn logo.
 */
export function PartnerServiceCard({ service, onClick }: { service: PartnerService; onClick?: () => void }) {
  return (
    <Link href={service.href} onClick={onClick} className="focus-ring group block rounded-[22px]">
      <div className={cn(LARGE_CARD_IMAGE_CLASS, !service.image && cn("bg-gradient-to-br", service.backdrop))}>
        {service.image ? (
          <Image
            src={service.image.src}
            alt={service.image.alt}
            fill
            sizes="(min-width: 1024px) 340px, (min-width: 640px) 44vw, 60vw"
            unoptimized={!isOptimizableImage(service.image.src)}
            className="object-cover transition-transform duration-700 group-hover:scale-105"
            style={service.image.position ? { objectPosition: service.image.position } : undefined}
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_85%_0%,rgba(255,255,255,0.14),transparent_60%)]" aria-hidden />
        )}
        {/* The provider's identity sits top-left, clear of the subject of
            its photo (which providers frame low, like a car on the ground). */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/55 to-transparent" aria-hidden />
        <div className="absolute inset-x-4 top-4 flex items-center gap-3 sm:inset-x-5 sm:top-5">
          {service.logoSrc && (
            // The provider's own logo, as supplied - never redrawn or recoloured -
            // on a small tile, with its name beside it so it reads at any size.
            <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl shadow-[var(--shadow-card)] ring-1 ring-white/25 sm:h-14 sm:w-14">
              <Image src={service.logoSrc} alt="" fill sizes="56px" className="object-cover" />
            </span>
          )}
          <div className="min-w-0 text-white [text-shadow:0_1px_10px_rgba(0,0,0,0.35)]">
            <p className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{service.provider}</p>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-white/85 sm:text-xs">
              <ShieldCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {service.providerLabel}
            </p>
          </div>
        </div>
      </div>
      <div className="px-1 pt-4">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-700">{service.category}</p>
        <p className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground transition-colors duration-200 group-hover:text-brand-800 sm:text-lg">
          {service.title}
        </p>
        <p className="mt-1 line-clamp-3 text-sm text-stone-500">{service.description}</p>
        <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5 border-t border-border-subtle pt-3">
          {service.price && (
            <p className="text-sm text-stone-600">
              <span className="font-serif text-xl text-brand-800">{service.price.label}</span>{" "}
              <span className="whitespace-nowrap">{service.price.detail.toLowerCase()}</span>
            </p>
          )}
          <p className="flex items-center gap-1 whitespace-nowrap text-sm font-medium text-brand-700">
            {service.cta}
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
          </p>
        </div>
      </div>
    </Link>
  );
}

/**
 * Width of one card slot in a LargeCardRail, shared with the skeleton so the
 * two can't drift apart. Phones: 60vw - with the 24px page gutter and a
 * 16px gap, one full card plus about half of the next. Tablet: 44vw, about
 * two cards. Desktop: 30% of the content width, about three and a third.
 */
export const LARGE_CARD_SLOT_CLASS = "w-[60vw] max-w-[340px] shrink-0 sm:w-[44vw] lg:w-[30%] lg:max-w-none";

/** Loading placeholder matching LargeCardRail's slot sizes. */
export function LargeCardRailSkeleton() {
  const slot = (key: number) => (
    <div key={key} className={LARGE_CARD_SLOT_CLASS}>
      <div className="skeleton-shimmer aspect-square w-full rounded-[22px] sm:aspect-[4/3]" />
      <div className="skeleton-shimmer mt-4 h-5 w-2/3 rounded-full" />
      <div className="skeleton-shimmer mt-2 h-4 w-1/2 rounded-full" />
    </div>
  );
  // Same out-of-flow row as LargeCardRail, so the placeholder can't widen a phone's page either.
  return (
    <div className="relative" aria-hidden>
      <div className="invisible flex pb-4 pt-1">{slot(0)}</div>
      <div className="absolute inset-x-0 top-0 -mx-6 flex gap-4 overflow-hidden px-6 pb-4 pt-1 lg:mx-0 lg:gap-6 lg:px-0">
        {[0, 1, 2].map(slot)}
      </div>
    </div>
  );
}

/** Shared with ListingCard size="large" so both card types have the same corner radius, shadow and hover. */
export const LARGE_CARD_IMAGE_CLASS =
  "relative aspect-square w-full overflow-hidden rounded-[22px] shadow-[var(--shadow-card)] ring-1 ring-black/5 transition-shadow duration-300 group-hover:shadow-[var(--shadow-card-hover)] sm:aspect-[4/3]";

function LargeCardImageArea({ image }: { image: LargeCardImage }) {
  if ("photoSrc" in image) {
    return (
      <div className={cn(LARGE_CARD_IMAGE_CLASS, "bg-brand-50")}>
        {/* Sized to LARGE_CARD_SLOT_CLASS, so a phone downloads a card-sized photo. */}
        <Image
          src={image.photoSrc}
          alt=""
          fill
          sizes="(min-width: 1024px) 340px, (min-width: 640px) 44vw, 60vw"
          unoptimized={!isOptimizableImage(image.photoSrc)}
          className="object-cover transition-transform duration-700 group-hover:scale-105"
        />
      </div>
    );
  }

  const Icon = image.icon;
  if ("tone" in image) {
    return (
      <div className={cn(LARGE_CARD_IMAGE_CLASS, "bg-surface-muted")}>
        <div
          className="absolute inset-0 bg-[radial-gradient(120%_90%_at_100%_0%,rgba(255,255,255,0.75),transparent_60%)]"
          aria-hidden
        />
        <svg
          className="absolute -bottom-[38%] -right-[24%] w-[90%] text-brand-200/50 transition-transform duration-700 group-hover:scale-105"
          viewBox="0 0 200 200"
          fill="none"
          aria-hidden
        >
          {[96, 72, 48].map((r) => (
            <circle key={r} cx="100" cy="100" r={r} stroke="currentColor" strokeWidth="0.75" />
          ))}
        </svg>
        <span className="absolute left-4 top-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface text-brand-700 shadow-[var(--shadow-card)] ring-1 ring-black/5 sm:left-5 sm:top-5 sm:h-14 sm:w-14">
          <Icon className="h-5 w-5 sm:h-6 sm:w-6" strokeWidth={1.5} aria-hidden />
        </span>
      </div>
    );
  }
  return (
    <div className={cn(LARGE_CARD_IMAGE_CLASS, "bg-gradient-to-br", image.gradient)}>
      <Icon
        className="absolute -bottom-5 -right-5 h-36 w-36 text-white/15 transition-transform duration-700 group-hover:scale-110 group-hover:-rotate-6 sm:h-44 sm:w-44"
        strokeWidth={1.25}
        aria-hidden
      />
      <span className="absolute left-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur-sm">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
    </div>
  );
}
