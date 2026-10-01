import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";

// Deliberately excludes providerId and category: moving an offering to a
// different provider or category is a bigger structural change than an
// edit, so an admin who wants that creates a new offering instead (the
// same restraint PromoCode's update route already applies to its own
// immutable-ish fields). priceCents IS editable - like Listing's own
// pricePerNightCents, each purchase already snapshots its own price onto
// BookingExtra, so a later change here only affects future purchases.
const updateOfferingSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  priceCents: z.number().int().min(1, "Price must be more than £0").optional(),
  active: z.boolean().optional(),
  features: z.array(z.string().trim().min(1).max(80)).max(10).optional(),
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

  const offering = await prisma.extraOffering.findUnique({ where: { id } });
  if (!offering) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const parsed = updateOfferingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  if (parsed.data.name && parsed.data.name !== offering.name) {
    const nameTaken = await prisma.extraOffering.findUnique({
      where: { providerId_name: { providerId: offering.providerId, name: parsed.data.name } },
    });
    if (nameTaken) {
      return NextResponse.json(
        { error: "This provider already has an offering with this name" },
        { status: 409 },
      );
    }
  }

  const updated = await prisma.extraOffering.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && {
        description: parsed.data.description?.trim() || null,
      }),
      ...(parsed.data.priceCents !== undefined && { priceCents: parsed.data.priceCents }),
      ...(parsed.data.active !== undefined && { active: parsed.data.active }),
      ...(parsed.data.features !== undefined && { features: parsed.data.features }),
    },
  });

  return NextResponse.json({ offering: updated });
}

export const PATCH = withApiErrorHandling(patchHandler);
