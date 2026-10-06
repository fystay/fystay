import { describe, expect, it } from "vitest";
import { MAX_PHOTO_EDGE_PX, MAX_UPLOAD_BYTES, fitWithin, jpegFileName } from "./photoUpload";

describe("fitWithin", () => {
  it("shrinks a phone photo to the longest-edge limit, keeping its shape", () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2560, height: 1920 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1920, height: 2560 });
  });

  it("never enlarges a small photo", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("handles a very long panorama without collapsing to zero", () => {
    expect(fitWithin(20000, 3)).toEqual({ width: MAX_PHOTO_EDGE_PX, height: 1 });
  });
});

describe("jpegFileName", () => {
  it("keeps the name people recognise and switches the extension", () => {
    expect(jpegFileName("IMG_2041.PNG")).toBe("IMG_2041.jpg");
    expect(jpegFileName("sea view.webp")).toBe("sea view.jpg");
    expect(jpegFileName("noextension")).toBe("noextension.jpg");
  });
});

describe("MAX_UPLOAD_BYTES", () => {
  it("stays under Vercel's 4.5MB request limit", () => {
    expect(MAX_UPLOAD_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });
});
