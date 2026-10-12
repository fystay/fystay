import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { withApiErrorHandling } from "@/lib/apiError";
import { checkRateLimit, rateLimitedResponse } from "@/lib/rateLimit";
import { isListingAiDraftConfigured } from "@/lib/listingAiDraft";
import {
  extractListingWithAi,
  fetchPublicListingText,
  ListingImportError,
  MAX_IMPORT_TEXT_LENGTH,
} from "@/lib/listingImport";

const bodySchema = z
  .object({
    url: z.string().trim().max(2000).optional(),
    text: z
      .string()
      .trim()
      .max(MAX_IMPORT_TEXT_LENGTH, `Keep the pasted text under ${MAX_IMPORT_TEXT_LENGTH.toLocaleString("en-GB")} characters.`)
      .optional(),
  })
  .refine((body) => Boolean(body.url) || (body.text?.length ?? 0) >= 50, {
    message: "Paste the listing details (at least a few lines), or a link to the public listing page.",
  });

/**
 * Admin-only: reads an owner's existing advert - pasted text, or a public
 * listing page - and returns a structured FYStay draft with the fields it
 * couldn't find or wasn't sure of. Saves nothing: the admin edits the
 * preview and saves it as a draft with POST /api/admin/properties.
 *
 * Pasted text wins over the link (the link is then only context), so an
 * admin whose link was refused can paste and try again.
 */
async function postHandler(request: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!isListingAiDraftConfigured()) {
    return NextResponse.json({ error: "Listing import isn't set up yet (ANTHROPIC_API_KEY)." }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid input" }, { status: 400 });
  }

  const rateLimit = await checkRateLimit({ key: `listing-import:${session.user.id}`, limit: 30, windowMs: 60 * 60 * 1000 });
  if (!rateLimit.allowed) return rateLimitedResponse(rateLimit);

  const { url, text } = parsed.data;
  let sourceText = text && text.length >= 50 ? text : null;
  let sourceUrl = url || null;
  const fromPage = !sourceText;
  if (!sourceText && url) {
    const page = await fetchPublicListingText(url);
    if (!page.ok) return NextResponse.json({ error: page.reason, needsText: true }, { status: 422 });
    sourceText = page.text;
    sourceUrl = page.finalUrl;
  }

  try {
    const result = await extractListingWithAi({ text: sourceText!, sourceUrl });
    return NextResponse.json({ ...result, source: { url: sourceUrl, fromPage } });
  } catch (error) {
    if (error instanceof ListingImportError) return NextResponse.json({ error: error.message }, { status: 422 });
    throw error;
  }
}

export const POST = withApiErrorHandling(postHandler);
