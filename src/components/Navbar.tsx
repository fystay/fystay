import Link from "next/link";
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
      {/* Below lg: the logo centred against the whole header width (an
          absolutely positioned overlay, so it stays exactly centred however
          wide the account controls on the right are), with the menu on the
          right. From lg: logo left, the section control centred, secondary
          links and the menu right. pointer-events-none/auto so the overlays
          never block clicks on anything beside them. */}
      <div className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
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

        {/* ml-auto: below lg the centred logo is an overlay, so this is the
            row's only in-flow item and would otherwise sit on the left. */}
        <div className="relative z-10 ml-auto flex items-center gap-6">
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
