import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserDetailForAdmin } from "@/lib/adminUserLookup";
import { withApiErrorHandling } from "@/lib/apiError";

/**
 * "What's going on with this account" for support - role, verification/2FA
 * state, recent bookings/listings, referral info. Not a data export (that's
 * a separate self-service feature already) - just enough for a support
 * conversation.
 */
async function getHandler(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getUserDetailForAdmin(id);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({ user });
}

export const GET = withApiErrorHandling(getHandler);
