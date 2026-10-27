import { Skeleton } from "@/components/ui/Skeleton";
import { ARCH_SHAPE_CLASS } from "@/components/LargeCard";
import { cn } from "@/lib/cn";

export function ListingCardSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className={cn("w-full", ARCH_SHAPE_CLASS)} />
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-[2.5rem] w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

export function ListingsGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <ListingCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function ListingsCarouselSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex gap-6 overflow-hidden">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="w-[46%] shrink-0 sm:w-[31%] lg:w-[23%]">
          <ListingCardSkeleton />
        </div>
      ))}
    </div>
  );
}
