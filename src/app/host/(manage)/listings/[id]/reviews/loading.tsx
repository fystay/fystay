import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-8">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-3 h-7 w-52" />

      <Skeleton className="mt-6 h-28 w-full rounded-2xl" />

      <div className="mt-6 flex flex-col gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-32 w-full rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
