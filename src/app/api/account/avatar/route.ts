import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { uploadUserAvatar } from "@/lib/storage";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { MAX_UPLOAD_BYTES, PHOTO_TOO_LARGE_MESSAGE } from "@/lib/photoUpload";

// Matches the "avatars" Supabase bucket's own configured limit/allow-list
// exactly (see storage.ts) - rejecting here first gives a real error
// message instead of a generic 502 once the upload itself is rejected.
// The avatars bucket itself only accepts these three.
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Any signed-in role (unlike /api/uploads, which is host-only for listing
 * photos) - a guest's own avatar is just as real a profile detail as a
 * host's.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limit = await checkRateLimit({
    key: `account-avatar:${session.user.id}`,
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!limit.allowed) return rateLimitedResponse(limit);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: "Photos must be JPG, PNG or WebP files." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: PHOTO_TOO_LARGE_MESSAGE }, { status: 400 });
  }

  const result = await uploadUserAvatar(file, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await prisma.user.update({
    where: { id: session.user.id },
    data: { image: result.url },
  });

  return NextResponse.json({ url: result.url }, { status: 201 });
}
