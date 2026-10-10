import { ImageResponse } from "next/og";
import { BRAND_COLORS, BRAND_FONT_NAME, brandFonts } from "@/lib/brandImage";

// The default share image for any page without its own (listing pages use
// their cover photo): the FYStay lockup - wordmark over "For Your Stay" -
// and an accurate coverage line, centred with generous margins so nothing
// important is lost when a platform crops it to a square or a 1.91:1 card.
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "FYStay - For Your Stay. Independent stays from local hosts across Lancashire.";

export default async function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: BRAND_COLORS.cream,
          fontFamily: BRAND_FONT_NAME,
        }}
      >
        <div style={{ display: "flex", fontSize: 168, lineHeight: 1, letterSpacing: -3 }}>
          <span style={{ color: BRAND_COLORS.terracotta }}>FY</span>
          <span style={{ color: BRAND_COLORS.ink }}>Stay</span>
        </div>
        <div
          style={{
            marginTop: 22,
            display: "flex",
            fontSize: 34,
            letterSpacing: 12,
            textTransform: "uppercase",
            color: BRAND_COLORS.ink,
          }}
        >
          For Your Stay
        </div>
        <div style={{ marginTop: 44, width: 72, height: 3, background: BRAND_COLORS.terracotta, display: "flex" }} />
        <div style={{ marginTop: 40, display: "flex", fontSize: 34, color: "#6b5a52" }}>
          Independent stays from local hosts, across Lancashire
        </div>
      </div>
    ),
    { ...size, fonts: await brandFonts() },
  );
}
