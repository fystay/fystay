import Link from "next/link";
import { Home } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import { GuestMenu } from "@/components/GuestMenu";
import { Logo } from "@/components/Logo";
import { NavbarChrome } from "@/components/NavbarChrome";
import { DesktopNavLinks } from "@/components/DesktopNavLinks";
import { SectionPills, SectionPillsBar } from "@/components/SectionPills";

export async function Navbar() {
  const session = await auth();
  const unreadMessageCount = session?.user
    ? await prisma.message.count({
        where: {
          senderId: { not: session.user.id },
          readAt: null,
          conversation: { OR: [{ guestId: session.user.id }, { hostId: session.user.id }] },
        },
      })
    : 0;

  return (
    <NavbarChrome>
      {/* Below lg: the home button left, the logo centred against the whole
          header width (an absolutely positioned overlay, so it stays exactly
          centred however wide the account controls are), the menu right,
          and the section tabs as the header's second row (SectionPillsBar).
          From lg: logo left, the section control centred, secondary
          links and the menu right. pointer-events-none/auto so the overlays
          never block clicks on anything beside them. */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          aria-label="FYStay home"
          className="focus-ring relative z-10 flex h-9 w-9 items-center justify-center rounded-[10px] bg-brand-600 text-white hover:bg-brand-700 lg:hidden"
        >
          {/* Smaller and finer than the logo's weight, so the logo stays the header's focal point. */}
          <Home className="h-[18px] w-[18px]" strokeWidth={2.25} />
        </Link>

        <Link href="/" className="relative z-10 hidden items-center gap-2 lg:flex">
          <Logo size="lg" withTagline taglineClassName="mt-2 text-[7px] leading-tight" />
        </Link>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center lg:hidden">
          <Link href="/" className="pointer-events-auto flex items-center gap-2">
            <Logo size="lg" withTagline taglineClassName="mt-2 text-[7px] leading-tight" />
          </Link>
        </div>

        {/* lg: the Stays / Discover / Journeys / Services tabs sit inline,
            centred against the whole bar the same way the mobile logo is
            above. Below lg they're the header's second row instead. */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex">
          <SectionPills variant="header" className="pointer-events-auto" />
        </div>

        <div className="relative z-10 flex items-center gap-6">
          <DesktopNavLinks />
          <nav aria-label="Account" className="flex items-center gap-3">
            {session?.user ? (
              <UserMenu
                name={session.user.name ?? "Account"}
                role={session.user.role}
                unreadMessageCount={unreadMessageCount}
              />
            ) : (
              <GuestMenu />
            )}
          </nav>
        </div>
      </div>
      <SectionPillsBar />
    </NavbarChrome>
  );
}
