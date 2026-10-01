import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { grantAdmin } from "./adminBootstrap";

function fakePrisma(user: Record<string, unknown> | null) {
  const update = vi.fn();
  const prisma = { user: { findUnique: vi.fn(async () => user), update } } as unknown as PrismaClient;
  return { prisma, update };
}

const active = { id: "u1", role: "GUEST", deletedAt: null, suspendedAt: null };

describe("grantAdmin", () => {
  it("promotes an active account and signs it out everywhere", async () => {
    const { prisma, update } = fakePrisma(active);
    expect(await grantAdmin(prisma, " Owner@Example.com ")).toEqual({ outcome: "granted", previousRole: "GUEST" });
    expect(update).toHaveBeenCalledWith({
      where: { id: "u1" },
      data: { role: "ADMIN", sessionVersion: { increment: 1 } },
    });
  });

  it("never creates an account", async () => {
    const { prisma, update } = fakePrisma(null);
    expect((await grantAdmin(prisma, "nobody@example.com")).outcome).toBe("refused");
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses deleted and suspended accounts", async () => {
    for (const user of [{ ...active, deletedAt: new Date() }, { ...active, suspendedAt: new Date() }]) {
      const { prisma, update } = fakePrisma(user);
      expect((await grantAdmin(prisma, "x@example.com")).outcome).toBe("refused");
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("is a no-op for an existing admin", async () => {
    const { prisma, update } = fakePrisma({ ...active, role: "ADMIN" });
    expect(await grantAdmin(prisma, "x@example.com")).toEqual({ outcome: "already_admin" });
    expect(update).not.toHaveBeenCalled();
  });
});
