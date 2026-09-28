import "server-only";
import { createClient } from "@supabase/supabase-js";
import { assertNoProductionDatabaseOutsideProduction } from "@/lib/databaseIdentity";

const LISTING_PHOTOS_BUCKET = "listing-photos";
const AVATARS_BUCKET = "avatars";

function getStorageClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;

  // The service-role key bypasses RLS on the whole project - a preview
  // deployment must never write with production's (see databaseIdentity.ts).
  assertNoProductionDatabaseOutsideProduction();

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false },
  });
}

export function isStorageConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export async function uploadListingPhoto(
  file: File,
  ownerId: string,
): Promise<{ url: string } | { error: string }> {
  const client = getStorageClient();
  if (!client) {
    return { error: "Photo uploads aren't configured on this deployment yet." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await client.storage
    .from(LISTING_PHOTOS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    return { error: error.message };
  }

  const { data } = client.storage.from(LISTING_PHOTOS_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}

/**
 * A guest or host's own profile photo - a separate, already-provisioned
 * "avatars" bucket (public read, upload/delete scoped by folder) rather
 * than reusing listing-photos, since these two kinds of image serve
 * unrelated purposes and shouldn't share one bucket's lifecycle/quota.
 * Uploaded via the service-role client (as above), same as every other
 * upload in this app - the bucket's own per-user RLS policies exist for a
 * future direct-from-browser upload path, not this one.
 */
export async function uploadUserAvatar(
  file: File,
  userId: string,
): Promise<{ url: string } | { error: string }> {
  const client = getStorageClient();
  if (!client) {
    return { error: "Photo uploads aren't configured on this deployment yet." };
  }

  const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await client.storage
    .from(AVATARS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });

  if (error) {
    return { error: error.message };
  }

  const { data } = client.storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl };
}
