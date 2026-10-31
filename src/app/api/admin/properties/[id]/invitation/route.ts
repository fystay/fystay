import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { normalizeEmail, recordReviewEvent, sendHostInvitation } from "@/lib/listingOnboarding";

const newOwnerSchema = z.object({
  name: z.string().trim().min(2, "Add the owner's name").max(100),
  email: z.string().trim().email("Enter a valid email address").max(254),
  phone: z.string().trim().max(40).optional(),
  consentNote: z
    .string()
    .trim()
    .min(10, "Say how the owner agreed to FYStay contacting them about listing (who, how and when)")
    .max(500),
});

/**
 * Admin-only: emails (or re-emails, replacing the old link) the invitation
 * for a draft held for an owner who has no host account yet. Sending is an
 * explicit admin action - creating the draft never contacts anyone.
 */
async function postHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const rateLimit = await checkRateLimit({ key: `host-invitation:${session.user.id}`, limit: 20, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const listing = await prisma.listing.findUnique({
    where: { id },
    select: {
      preparedById: true,
      hostId: true,
      published: true,
      materialRevision: true,
      hostInvitation: { select: { id: true, email: true, name: true, acceptedAt: true, revokedAt: true } },
    },
  });
  if (!listing || !listing.preparedById) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let invitation = listing.hostInvitation;

  // A draft FYStay prepared with no owner attached yet (held by the admin
  // who prepared it): the owner's details come with this request, and the
  // listing is then held against their invitation like any other.
  if (!invitation && listing.hostId === listing.preparedById && !listing.published) {
    const parsed = newOwnerSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Add the owner's details" }, { status: 400 });
    }
    const created = await prisma.hostInvitation.create({
      data: {
        email: normalizeEmail(parsed.data.email),
        name: parsed.data.name,
        phone: parsed.data.phone || null,
        consentNote: parsed.data.consentNote,
        invitedById: session.user.id,
      },
      select: { id: true, email: true, name: true, acceptedAt: true, revokedAt: true },
    });
    await prisma.listing.updateMany({
      where: { id, hostInvitationId: null },
      data: { hostInvitationId: created.id },
    });
    invitation = created;
  }
  if (!invitation || invitation.acceptedAt) {
    return NextResponse.json({ error: "The owner already has access to this listing." }, { status: 409 });
  }
  if (invitation.revokedAt) return NextResponse.json({ error: "This invitation was withdrawn." }, { status: 409 });

  const heldTitles = await prisma.listing.findMany({ where: { hostInvitationId: invitation.id }, select: { title: true } });
  const result = await sendHostInvitation(prisma, invitation, heldTitles.map((l) => l.title), {
    local: isLocalEnvironment(),
  });
  await recordReviewEvent(prisma, {
    listingId: id,
    type: "INVITATION_SENT",
    revision: listing.materialRevision,
    actor: { id: session.user.id, role: session.user.role },
    note: result.sent ? `Emailed to ${invitation.email}` : `Link created; email not sent (${result.devUrl ? "local development" : "email isn't configured"})`,
  });

  return NextResponse.json({ sent: result.sent, ...(result.devUrl && { devUrl: result.devUrl }) });
}

export const POST = withApiErrorHandling(postHandler);
