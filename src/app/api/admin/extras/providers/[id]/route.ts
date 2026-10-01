import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

// Unlike PromoCode's own update route, every field here is safely
// editable after the fact: nothing about a provider is snapshotted onto a
// past BookingExtra (only the offering's priceCents is - see its own
// schema comment), so renaming a provider or fixing its email/category
// doesn't rewrite the meaning of any historical record.
const updateProviderSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  category: z.enum(["AIRPORT_TRANSFER", "ATTRACTION_TICKET", "CAR_HIRE"]).optional(),
  notificationEmail: z.string().trim().email("Enter a valid email address").optional(),
  bookingFormUrl: z.string().trim().url("Enter a valid URL").nullable().optional(),
  active: z.boolean().optional(),
});

async function patchHandler(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const provider = await prisma.extraProvider.findUnique({ where: { id } });
  if (!provider) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateProviderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (parsed.data.name && parsed.data.name !== provider.name) {
    const nameTaken = await prisma.extraProvider.findUnique({ where: { name: parsed.data.name } });
    if (nameTaken) {
      return NextResponse.json(
        { error: "A provider with this name already exists" },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.extraProvider.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.category !== undefined && { category: parsed.data.category }),
      ...(parsed.data.notificationEmail !== undefined && {
        notificationEmail: parsed.data.notificationEmail,
      }),
      ...(parsed.data.bookingFormUrl !== undefined && { bookingFormUrl: parsed.data.bookingFormUrl }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
    },
  });

  return NextResponse.json({ provider: updated });
}

export const PATCH = withApiErrorHandling(patchHandler);
