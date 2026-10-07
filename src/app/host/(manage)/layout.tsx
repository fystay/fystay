import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hostBadgeCounts } from "@/lib/hostAttention";
import { HostNav } from "@/components/host/HostNav";

// Every hosting page (not the public /host page) shares the hosting menu.
// Each page still checks sign-in and role itself - this layout only adds
// the menu when the visitor is a host.
export default async function HostManageLayout({ children }: LayoutProps<"/host">) {
  const session = await auth();
  const isHost = session?.user?.role === "HOST";
  const counts = isHost ? await hostBadgeCounts(prisma, session.user.id) : null;

  return (
    <>
      {counts && <HostNav actionCount={counts.actionCount} unreadMessages={counts.unreadMessages} />}
      {children}
    </>
  );
}
