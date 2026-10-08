import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { hostBadgeCounts } from "@/lib/hostAttention";
import { HostNav } from "@/components/host/HostNav";

/**
 * The hosting menu, shown only to a signed-in host - on the hosting pages,
 * and on Messages and Account, which hosts reach from that menu and would
 * otherwise have no one-tap way back from.
 */
export async function HostNavIfHost() {
  const session = await auth();
  if (session?.user?.role !== "HOST") return null;
  const counts = await hostBadgeCounts(prisma, session.user.id);
  return <HostNav actionCount={counts.actionCount} unreadMessages={counts.unreadMessages} />;
}
