import Link from "next/link";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import { GuestMenu } from "@/components/GuestMenu";
import { SiteMenu } from "@/components/SiteMenu";
import { Logo } from "@/components/Logo";
import { NavbarChrome } from "@/components/NavbarChrome";
import { DesktopNavLinks } from "@/components/DesktopNavLinks";
import { SavedLink } from "@/components/SavedLink";

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
          wide the controls are), Saved and the account menu right.
          From lg: logo left, secondary links, Saved and the menu right. pointer-events-none/auto so the overlays
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

        <div className="relative z-10 flex items-center gap-6">
          <DesktopNavLinks />
          <SavedLink />
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
