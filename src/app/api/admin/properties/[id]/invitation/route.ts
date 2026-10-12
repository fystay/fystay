import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { isLocalEnvironment } from "@/lib/deploymentEnvironment";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { recordReviewEvent, sendHostInvitation } from "@/lib/listingOnboarding";

/**
 * Admin-only: emails (or re-emails, replacing the old link) the invitation
 * for a draft held for an owner who has no host account yet. Sending is an
 * explicit admin action - creating the draft never contacts anyone.
 */
async function postHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
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
      materialRevision: true,
      hostInvitation: { select: { id: true, email: true, name: true, acceptedAt: true, revokedAt: true } },
    },
  });
  if (!listing || !listing.preparedById) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const invitation = listing.hostInvitation;
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
