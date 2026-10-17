import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import { GuestMenu } from "@/components/GuestMenu";
import { SiteMenu } from "@/components/SiteMenu";
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
      {/* Below lg: the site menu (About, Help, Contact, List your property)
          left, the logo centred against the whole header width (an
          absolutely positioned overlay, so it stays exactly centred however
          wide the controls are), the account menu right,
          and the sections in the bottom tab bar (SiteBottomNav, in the
          root layout).
          From lg: logo left, the section control centred, secondary
          links and the menu right. pointer-events-none/auto so the overlays
          never block clicks on anything beside them. */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="relative z-10 lg:hidden">
          <SiteMenu />
        </div>

        <Link href="/" className="relative z-10 hidden items-center gap-2 lg:flex">
          <Logo size="lg" withTagline />
        </Link>

        <div className="pointer-events-none absolute inset-0 flex items-center justify-center lg:hidden">
          <Link href="/" className="pointer-events-auto flex items-center gap-2">
            <Logo size="lg" withTagline />
          </Link>
        </div>

        {/* lg: the Stays / Experiences / Services / Saved tabs sit inline,
            centred against the whole bar the same way the mobile logo is
            above. Below lg they're the bottom tab bar instead. */}
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
    </NavbarChrome>
  );
}
