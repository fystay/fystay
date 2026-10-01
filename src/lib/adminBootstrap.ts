import type { PrismaClient } from "@prisma/client";

export type GrantAdminResult =
  | { outcome: "granted"; previousRole: string }
  | { outcome: "already_admin" }
  | { outcome: "refused"; reason: string };

/**
 * Makes an existing account an ADMIN. The app itself has no way to create
 * the first admin (no signup or UI grants the role, by design), so this is
 * how an operator bootstraps one - run from scripts/admin/grant-admin.ts.
 *
 * Only an existing, active account can be promoted: it never creates a user
 * (so it can't mint an admin login nobody owns) and refuses deleted or
 * suspended accounts. Bumping sessionVersion signs the account out
 * everywhere, so the new role is picked up on a fresh login.
 */
export async function grantAdmin(prisma: PrismaClient, rawEmail: string): Promise<GrantAdminResult> {
  const email = rawEmail.trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, role: true, deletedAt: true, suspendedAt: true },
  });
  if (!user) return { outcome: "refused", reason: "No account exists with that email - sign up first." };
  if (user.deletedAt) return { outcome: "refused", reason: "That account has been deleted." };
  if (user.suspendedAt) return { outcome: "refused", reason: "That account is suspended." };
  if (user.role === "ADMIN") return { outcome: "already_admin" };

  await prisma.user.update({
    where: { id: user.id },
    data: { role: "ADMIN", sessionVersion: { increment: 1 } },
  });
  return { outcome: "granted", previousRole: user.role };
}
