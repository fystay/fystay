import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

const createProviderSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(200),
  category: z.enum(["AIRPORT_TRANSFER", "ATTRACTION_TICKET", "CAR_HIRE"]),
  notificationEmail: z.string().trim().email("Enter a valid email address"),
  bookingFormUrl: z.string().trim().url("Enter a valid URL").optional().or(z.literal("")),
});

/**
 * Trip Extras providers (see docs/trip-extras-roadmap.md) - a business
 * FYStay resells add-ons for, e.g. EV Exec. ADMIN-only, same access rule
 * as promo codes: these are FYStay's own commercial partners, not
 * something a host manages.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const parsed = createProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const existing = await prisma.extraProvider.findUnique({ where: { name: parsed.data.name } });
  if (existing) {
    return NextResponse.json(
      { error: "A provider with this name already exists" },
      { status: 409 },
    );
  }

  const provider = await prisma.extraProvider.create({
    data: {
      name: parsed.data.name,
      category: parsed.data.category,
      notificationEmail: parsed.data.notificationEmail,
      bookingFormUrl: parsed.data.bookingFormUrl || null,
    },
  });

  return NextResponse.json({ provider }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
