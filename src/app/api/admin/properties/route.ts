import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { withApiErrorHandling } from "@/lib/apiError";
import { normalizeEmail, recordReviewEvent } from "@/lib/listingOnboarding";
import { listingFieldSchemas } from "@/lib/validation";
import { AMENITY_OPTIONS } from "@/lib/amenityOptions";
import { PROPERTY_TYPES, type PropertyType } from "@/lib/propertyType";

const createPropertySchema = z.object({
  title: z.string().trim().min(3, "Give the property a working title").max(120),
  city: z.string().trim().min(1, "Add the town").max(100),
  country: z.string().trim().min(1).max(100).default("United Kingdom"),
  propertyType: z.enum(PROPERTY_TYPES as [PropertyType, ...PropertyType[]]),
  // Optional details from an import (POST /api/admin/properties/import),
  // checked by the admin in the preview. Anything left out starts blank.
  details: z
    .object({
      description: z.union([listingFieldSchemas.description, z.literal("")]).optional(),
      address: z.string().trim().max(200).optional(),
      bedrooms: z.number().int().min(0).max(50).optional(),
      bathrooms: z.number().int().min(0).max(50).optional(),
      maxGuests: z.number().int().min(1).max(50).optional(),
      amenities: z.array(z.enum(AMENITY_OPTIONS as [string, ...string[]])).max(AMENITY_OPTIONS.length).optional(),
      additionalRules: z.string().trim().max(2000).optional(),
      pricePerNightCents: listingFieldSchemas.pricePerNightCents.optional(),
    })
    .optional(),
  host: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("existing"), userId: z.string().min(1) }),
    z.object({
      kind: z.literal("invite"),
      name: z.string().trim().min(2, "Add the owner's name").max(100),
      email: z.string().trim().email("Enter a valid email address").max(254),
      phone: z.string().trim().max(40).optional(),
      consentNote: z
        .string()
        .trim()
        .min(10, "Say how the owner agreed to FYStay contacting them about listing (who, how and when)")
        .max(500),
    }),
  ]),
});

/**
 * Admin-only "Add a property": starts a private draft listing for an
 * owner. For an existing host the draft is theirs straight away (they can
 * open it, but it isn't public). For an owner without a host account it is
 * held by FYStay against a HostInvitation until they sign in with that
 * email and accept - no account is created for them. Either way it starts
 * unpublished in DRAFT, with blank details for the admin to fill in, or the
 * details the admin checked in an import preview.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = createPropertySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }
  const { host, details, ...property } = parsed.data;
  const admin = { id: session.user.id, role: session.user.role };

  let hostId: string;
  let hostInvitationId: string | null = null;
  if (host.kind === "existing") {
    const user = await prisma.user.findUnique({
      where: { id: host.userId },
      select: { id: true, role: true, suspendedAt: true, deletedAt: true },
    });
    if (!user || user.deletedAt) return NextResponse.json({ error: "That host wasn't found." }, { status: 404 });
    if (user.suspendedAt) return NextResponse.json({ error: "That account is suspended." }, { status: 409 });
    if (user.role !== "HOST") {
      return NextResponse.json(
        { error: "That account isn't a host yet. Invite them by email instead, so they turn hosting on themselves." },
        { status: 409 },
      );
    }
    hostId = user.id;
  } else {
    const invitation = await prisma.hostInvitation.create({
      data: {
        email: normalizeEmail(host.email),
        name: host.name,
        phone: host.phone || null,
        consentNote: host.consentNote,
        invitedById: admin.id,
      },
    });
    hostId = admin.id;
    hostInvitationId = invitation.id;
  }

  const listing = await prisma.$transaction(async (tx) => {
    const created = await tx.listing.create({
      data: {
        ...property,
        description: details?.description ?? "",
        address: details?.address || null,
        pricePerNightCents: details?.pricePerNightCents ?? 0,
        ...(details?.bedrooms !== undefined && { bedrooms: details.bedrooms }),
        ...(details?.bathrooms !== undefined && { bathrooms: details.bathrooms }),
        ...(details?.maxGuests !== undefined && { maxGuests: details.maxGuests }),
        additionalRules: details?.additionalRules || null,
        photos: [],
        amenities: details?.amenities ?? [],
        published: false,
        hostId,
        hostInvitationId,
        preparedById: admin.id,
        reviewStatus: "DRAFT",
      },
      select: { id: true, materialRevision: true },
    });
    await recordReviewEvent(tx, { listingId: created.id, type: "PREPARED", revision: created.materialRevision, actor: admin });
    return created;
  });

  return NextResponse.json({ listing: { id: listing.id } }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
