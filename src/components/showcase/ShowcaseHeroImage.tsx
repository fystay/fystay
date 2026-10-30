import Image from "next/image";
import type { ShowcasePhoto } from "@/lib/showcase/types";

/**
 * The listing page's hero background, as on the homepage: the property's
 * single best photo edge to edge, dissolving into the page at the foot, with
 * a cream wash on the text side so the headline reads on any photo. One
 * still photo on purpose - a rotation would show the softer photos at hero
 * size; the rest of the gallery sits just below (ShowcaseGalleryStrip).
 */
export function ShowcaseHeroImage({ photo }: { photo: ShowcasePhoto }) {
  return (
    <>
      <div className="absolute inset-0 -z-10 overflow-hidden [mask-image:linear-gradient(to_top,transparent_0,#000_70px)] lg:[mask-image:linear-gradient(to_top,transparent_0,#000_110px)]">
        <div className="absolute inset-0 bg-ink">
          <Image src={photo.src} alt={photo.alt} fill priority sizes="100vw" className={`object-cover ${photo.position ?? ""}`} />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(240,238,230,0.92)_0%,rgba(240,238,230,0.88)_62%,rgba(240,238,230,0.4)_78%,rgba(240,238,230,0)_90%)] sm:bg-[linear-gradient(90deg,rgba(240,238,230,0.92)_0%,rgba(240,238,230,0.78)_40%,rgba(240,238,230,0.25)_58%,rgba(240,238,230,0)_70%)]" />
      </div>
    </>
  );
}
