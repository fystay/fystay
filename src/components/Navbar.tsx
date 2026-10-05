import Link from "next/link";
import { Home } from "lucide-react";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import { GuestMenu } from "@/components/GuestMenu";
import { Logo } from "@/components/Logo";
import { NavbarChrome } from "@/components/NavbarChrome";
import { DesktopNavLinks } from "@/components/DesktopNavLinks";
import { SectionPills } from "@/components/SectionPills";

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
      {/* relative + an absolutely-positioned centering layer, rather than a
          grid with an empty balancing column: a grid track sized to "the
          rest of the space" still has to yield to its content's minimum
          width, so an empty left column and the (non-empty) nav's column
          end up different sizes and the logo lands off-center by roughly
          half that difference. Centering the logo against the *whole*
          header width via this overlay, independent of however wide the
          signed-in/signed-out nav controls happen to be, keeps it exactly
          centered regardless. pointer-events-none/auto so the transparent
          overlay never blocks clicks on the icon or the nav on either
          side of it.

          This whole centered-icon layout is the <lg (and every non-home
          page's) treatment only - at lg: on the homepage it gives way to a
          conventional left-logo/center-links/right-menu bar (see the
          lg:hidden / hidden lg:flex pairs below), matching the transparent
          hero nav design without touching how every other page's desktop
          nav, or any page's mobile nav, already looks. */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link
          href="/"
          aria-label="FYStay home"
          className="relative z-10 flex h-10 w-10 items-center justify-center rounded-lg border border-transparent bg-brand-600 text-white lg:hidden group-data-[tone=hero]/nav:border-white/25 group-data-[tone=hero]/nav:bg-white/10 group-data-[tone=hero]/nav:backdrop-blur-md"
        >
          <Home className="h-6 w-6" strokeWidth={2.5} />
        </Link>

        <Link href="/" className="relative z-10 hidden items-center gap-2 lg:flex">
          <Logo size="lg" withTagline taglineClassName="mt-2 text-[7px] leading-tight" />
        </Link>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center lg:hidden">
          <Link href="/" className="pointer-events-auto flex items-center gap-2">
            <Logo size="lg" withTagline taglineClassName="mt-2 text-[7px] leading-tight" />
          </Link>
        </div>

        {/* lg: the Stays / Explore / Travel / Services control sits in the
            header itself, centred against the whole bar the same way the
            mobile logo is above (independent of how wide the logo and the
            right-hand controls are). Below lg it sits under the header
            instead - in the homepage hero, or SectionPillsBar elsewhere. */}
        <div className="pointer-events-none absolute inset-0 hidden items-center justify-center lg:flex">
          <SectionPills className="pointer-events-auto" />
        </div>

        <div className="relative z-10 flex items-center gap-6">
          <DesktopNavLinks />
          <nav className="flex items-center gap-3">
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
    </NavbarChrome>
  );
}
