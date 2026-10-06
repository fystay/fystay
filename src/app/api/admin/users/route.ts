import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { MIN_QUERY_LENGTH, searchUsersForAdmin } from "@/lib/adminUserLookup";
import { withApiErrorHandling } from "@/lib/apiError";

/** Same reasoning as /api/admin/bookings - refuses a trivial query rather than paging the whole users table. */
async function getHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const users = await searchUsersForAdmin(q);
  if (users === null) {
    return NextResponse.json(
      { error: `Enter at least ${MIN_QUERY_LENGTH} characters to search` },
      { status: 400 },
    );
  }

  return NextResponse.json({ users });
}

export const GET = withApiErrorHandling(getHandler);
