import { ImageResponse } from "next/og";
import { brandFonts, MonogramTile } from "@/lib/brandImage";

// Home-screen icon. Square corners: iOS applies its own rounded mask, and a
// pre-rounded tile would show cream corners inside it.
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
  return new ImageResponse(<MonogramTile size={size.width} rounded={false} />, {
    ...size,
    fonts: await brandFonts(),
  });
}
