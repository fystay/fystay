import { ImageResponse } from "next/og";
import { brandFonts, MonogramTile } from "@/lib/brandImage";

// The browser-tab favicon: the FYStay "FY" monogram on its terracotta tile
// (docs/brand/fystay-brand.md) - the brand's own serif, so the tab matches
// the wordmark in the header rather than a generic sans "FY".
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  return new ImageResponse(<MonogramTile size={size.width} />, { ...size, fonts: await brandFonts() });
}
