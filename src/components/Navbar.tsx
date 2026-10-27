import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { UserMenu } from "@/components/UserMenu";
import { GuestMenu } from "@/components/GuestMenu";
import { NavbarChrome } from "@/components/NavbarChrome";
import { HeaderBar } from "@/components/HeaderBar";

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

  // The header's one host link: where new hosts start, or a host's own
  // dashboard. Admins get the guest link like anyone else.
  const host =
    session?.user?.role === "HOST"
      ? { href: "/host/dashboard", label: "Host dashboard" }
      : { href: "/host", label: "List your property" };

  return (
    <NavbarChrome>
      <HeaderBar
        host={host}
        account={
          <nav aria-label="Account">
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
        }
      />
    </NavbarChrome>
  );
}
