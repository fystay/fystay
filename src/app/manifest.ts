import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/seo";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME}: For Your Stay`,
    short_name: SITE_NAME,
    description:
      "Book independent holiday homes, apartments and guest houses from local hosts in Blackpool and on the Fylde Coast.",
    start_url: "/",
    display: "standalone",
    background_color: "#f6f3ec",
    theme_color: "#bc522f",
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
