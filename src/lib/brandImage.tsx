import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * The FYStay identity for generated images (favicon, app icon, share
 * image), which can't use the site's next/font serif: ImageResponse needs
 * the font file itself. DM Serif Display ships in assets/fonts under the
 * SIL Open Font License (see DMSerifDisplay-OFL.txt there). Colours match
 * globals.css; see docs/brand/fystay-brand.md for the rules.
 */
export const BRAND_COLORS = {
  terracotta: "#bc522f", // brand-600: the "FY" and the monogram tile
  ink: "#301a13", // "Stay" and descriptor text
  cream: "#f6f3ec", // page background, monogram letters
} as const;

export const BRAND_FONT_NAME = "DM Serif Display";

export async function brandFonts() {
  const data = await readFile(join(process.cwd(), "assets/fonts/DMSerifDisplay-Regular.ttf"));
  return [{ name: BRAND_FONT_NAME, data, style: "normal" as const, weight: 400 as const }];
}

/** The "FY" monogram on a terracotta tile - favicon, app icon, avatars. */
export function MonogramTile({ size, rounded = true }: { size: number; rounded?: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: BRAND_COLORS.terracotta,
        borderRadius: rounded ? Math.round(size * 0.22) : 0,
      }}
    >
      <span
        style={{
          fontFamily: BRAND_FONT_NAME,
          fontSize: Math.round(size * 0.58),
          color: BRAND_COLORS.cream,
          letterSpacing: -size * 0.01,
          // The serif's capitals sit high in their line box; this nudges
          // the pair to the tile's optical centre.
          marginTop: Math.round(size * 0.04),
          display: "flex",
        }}
      >
        FY
      </span>
    </div>
  );
}
