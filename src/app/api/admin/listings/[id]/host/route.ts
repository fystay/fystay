import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";

const bodySchema = z
  .object({
    hostId: z.string().min(1).optional(),
    hostEmail: z.string().trim().email("Enter the new host's email address").max(254).optional(),
    note: z.string().trim().max(500).optional(),
  })
  .refine((b) => Boolean(b.hostId || b.hostEmail), { message: "Say which host should have the listing." });

/**
 * Admin-only: assign or transfer a listing to a host. The only way a
 * listing's host ever changes - hosts can't do it (POST and PATCH on
 * /api/listings ignore any hostId they send).
 *
 * The listing comes off the site until the new host has looked at it:
 * unpublished, and a FYStay-prepared listing goes back to DRAFT so the new
 * host approves it themselves. Refused while anything still ties it to the
 * current host: upcoming bookings (their money goes to that host's
 * payouts), guest message threads (new messages would reach the wrong
 * person) or a property-management connection. The old host's calendar
 * links stop working.
 */
async function putHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { hostId, hostEmail, note } = parsed.data;
  const hostSelect = { id: true, name: true, role: true, suspendedAt: true, deletedAt: true } as const;

  const [listing, newHost] = await Promise.all([
    prisma.listing.findUnique({
      where: { id },
      select: { id: true, hostId: true, hostInvitationId: true, preparedById: true, host: { select: { name: true } } },
    }),
    hostId
      ? prisma.user.findUnique({ where: { id: hostId }, select: hostSelect })
      : prisma.user.findFirst({ where: { email: { equals: hostEmail!, mode: "insensitive" } }, select: hostSelect }),
  ]);
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });
  if (!newHost || newHost.deletedAt) return NextResponse.json({ error: "That host wasn't found." }, { status: 404 });
  if (newHost.role !== "HOST") {
    return NextResponse.json({ error: "That account isn't a host. They need to turn on hosting first." }, { status: 409 });
  }
  if (newHost.suspendedAt) return NextResponse.json({ error: "That host's account is suspended." }, { status: 409 });
  if (listing.hostId === newHost.id && !listing.hostInvitationId) {
    return NextResponse.json({ error: "That host already has this listing." }, { status: 409 });
  }

  const [upcomingBookings, conversations, pmsMappings] = await Promise.all([
    prisma.booking.count({ where: { listingId: id, status: { in: ["PENDING", "CONFIRMED"] }, checkOut: { gte: new Date() } } }),
    prisma.conversation.count({ where: { listingId: id } }),
    prisma.pmsRoomMapping.count({ where: { listingId: id } }),
  ]);
  if (upcomingBookings > 0) {
    return NextResponse.json(
      { error: "This listing has upcoming bookings paid out to its current host. Wait until they're over, or cancel them first." },
      { status: 409 },
    );
  }
  if (conversations > 0) {
    return NextResponse.json(
      { error: "Guests have message threads with the current host on this listing, so it can't change hands here." },
      { status: 409 },
    );
  }
  if (pmsMappings > 0) {
    return NextResponse.json(
      { error: "The current host's property-management system is connected to this listing. Disconnect it first." },
      { status: 409 },
    );
  }

  await prisma.$transaction(async (tx) => {
    if (listing.hostInvitationId) {
      await tx.hostInvitation.updateMany({
        where: { id: listing.hostInvitationId, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date(), tokenHash: null },
      });
    }
    await tx.listing.update({
      where: { id },
      data: {
        hostId: newHost.id,
        hostInvitationId: null,
        published: false,
        icalImportUrl: null,
        icalExportToken: randomBytes(16).toString("hex"),
        ...(listing.preparedById && {
          reviewStatus: "DRAFT",
          approvedRevision: null,
          approvedAt: null,
          approvedById: null,
          approvedSnapshot: Prisma.DbNull,
        }),
      },
    });
    await tx.adminAuditEvent.create({
      data: {
        actorId: session.user.id,
        action: "LISTING_ASSIGNED",
        targetListingId: id,
        targetUserId: newHost.id,
        note: [
          listing.hostInvitationId ? "From a pending owner invitation" : `From ${listing.host.name} (${listing.hostId})`,
          `to ${newHost.name}`,
          note,
        ]
          .filter(Boolean)
          .join(" · "),
      },
    });
  });

  return NextResponse.json({ listing: { id, hostId: newHost.id, published: false } });
}

export const PUT = withApiErrorHandling(putHandler);
