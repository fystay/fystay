import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { uploadListingPhoto } from "@/lib/storage";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { MAX_UPLOAD_BYTES, PHOTO_TOO_LARGE_MESSAGE } from "@/lib/photoUpload";
import { withApiErrorHandling } from "@/lib/apiError";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "HOST") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Caps storage/bandwidth cost from a single compromised or scripted
  // host account, not normal photo-adding activity - a real listing's
  // whole gallery comfortably fits well under this in one sitting.
  const rateLimit = await checkRateLimit({
    key: `uploads:${session.user.id}`,
    limit: 60,
    windowMs: 15 * 60 * 1000,
  });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json(
      { error: "Photos must be JPG, PNG, WebP or GIF files." },
      { status: 400 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: PHOTO_TOO_LARGE_MESSAGE }, { status: 400 });
  }

  const result = await uploadListingPhoto(file, session.user.id);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({ url: result.url }, { status: 201 });
}

export const POST = withApiErrorHandling(postHandler);
