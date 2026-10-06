/**
 * Getting a photo from someone's phone onto FYStay safely.
 *
 * A Vercel function refuses any request body over about 4.5MB before our
 * code even runs, and phone photos are routinely 3-8MB - so a photo is
 * resized in the browser first: longest side at most MAX_PHOTO_EDGE_PX,
 * re-saved as a JPEG. Re-saving also does two things a raw upload doesn't:
 * the camera's rotation flag is applied to the pixels (so a portrait shot
 * never shows sideways), and the photo's metadata is dropped - including
 * the GPS position a phone records, which on a listing photo would give
 * away the host's address that FYStay only shares once a guest has booked.
 *
 * The server checks the size again (MAX_UPLOAD_BYTES) in case a browser
 * couldn't resize, and the storage buckets have their own limits too.
 */

/** Sharp on a large desktop screen, and well under the upload limit as a JPEG. */
export const MAX_PHOTO_EDGE_PX = 2560;

/** Under Vercel's ~4.5MB request limit, with room for the multipart form around the file. */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export const PHOTO_TOO_LARGE_MESSAGE = "That photo is too large. Please choose one under 4MB.";

const JPEG_QUALITY = 0.85;

/** The width and height a photo is resized to, keeping its shape. Never enlarges. */
export function fitWithin(width: number, height: number, maxEdge: number = MAX_PHOTO_EDGE_PX) {
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** "IMG_2041.HEIC.png" -> "IMG_2041.HEIC.jpg"; keeps the name people recognise. */
export function jpegFileName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, "");
  return `${base || "photo"}.jpg`;
}

/**
 * Resizes and re-saves a photo in the browser, ready to upload. GIFs pass
 * through untouched (re-saving would lose their animation), as does
 * anything the browser can't decode - the server then decides. Throws only
 * for a photo that's still too large afterwards, with a message to show.
 */
export async function preparePhotoForUpload(file: File): Promise<File> {
  if (file.type === "image/gif" || typeof createImageBitmap !== "function") {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    return file;
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    bitmap.close();
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    return file;
  }
  // JPEG has no transparency - a PNG's see-through areas become white, not black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
  if (!blob) {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
    return file;
  }
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error(PHOTO_TOO_LARGE_MESSAGE);
  return new File([blob], jpegFileName(file.name), { type: "image/jpeg", lastModified: file.lastModified });
}
