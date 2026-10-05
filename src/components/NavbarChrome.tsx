import { cn } from "@/lib/cn";

/**
 * The navbar's outer bar: the same opaque, sticky header on every page,
 * the homepage included - its video hero now starts below the header as a
 * framed panel (see page.tsx) rather than running up underneath it. The
 * light "hero" NavTone the header's children support (NavTone.tsx) is
 * therefore unused for now; every child renders its default look.
 */
export function NavbarChrome({ children }: { children: React.ReactNode }) {
  return (
    <header
      data-tone="default"
      className={cn("group/nav sticky top-0 z-30 border-b border-border-subtle bg-surface/90 backdrop-blur")}
    >
      {children}
    </header>
  );
}
