import Image from "next/image";
import { cn } from "@/lib/cn";
import { isOptimizableImage } from "@/lib/image";
import { wrapIndex } from "@/lib/imageRotation";

/**
 * A stack of images that crossfades between them in place - no sliding -
 * driven by useAutoRotate (or any index). Fills its parent, so the card's
 * own image box keeps its size and crop whatever is showing.
 *
 * At most three images are mounted: the current one, the previous one
 * (left fully visible underneath while the new one fades in over it, so
 * the change never dips through the background), and the next one, only
 * once `preloadNext` says rotation is actually running, so it's loaded
 * before it's needed. Every other photo stays unloaded until its turn.
 * The first image renders exactly as before, with no fade on page load.
 */
export function CrossfadeImages({
  photos,
  index,
  previous,
  preloadNext,
  alt,
  sizes,
  imageClassName,
}: {
  photos: string[];
  index: number;
  previous: number;
  preloadNext: boolean;
  alt: string;
  sizes: string;
  imageClassName?: string;
}) {
  const next = wrapIndex(index + 1, photos.length);
  const hasChanged = previous !== -1;

  return (
    <>
      {photos.map((photo, i) => {
        const isCurrent = i === index;
        const isPrevious = i === previous && !isCurrent;
        const isNext = preloadNext && i === next && !isCurrent && !isPrevious;
        if (!isCurrent && !isPrevious && !isNext) return null;
        return (
          <div
            key={i}
            className={cn(
              "absolute inset-0",
              isCurrent && "z-[2]",
              isCurrent && hasChanged && "animate-card-photo-fade",
              isPrevious && "z-[1]",
              isNext && "opacity-0",
            )}
            aria-hidden={isCurrent ? undefined : true}
          >
            <Image
              src={photo}
              alt={isCurrent ? alt : ""}
              fill
              className={imageClassName}
              sizes={sizes}
              unoptimized={!isOptimizableImage(photo)}
            />
          </div>
        );
      })}
    </>
  );
}
