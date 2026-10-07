import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-10 w-36 rounded-full" />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-2xl" />
        ))}
      </div>

      <div className="mt-8 flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 rounded-2xl border border-border-subtle p-4">
            <Skeleton className="h-20 w-28 shrink-0 rounded-xl" />
            <div className="flex-1">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="mt-2 h-3.5 w-1/3" />
              <Skeleton className="mt-3 h-5 w-40 rounded-full" />
              <Skeleton className="mt-3 h-14 w-full rounded-xl" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
