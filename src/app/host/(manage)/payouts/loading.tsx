import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-2xl flex-1 px-6 py-8">
      <Skeleton className="h-5 w-36" />
      <Skeleton className="mt-3 h-7 w-28" />
      <Skeleton className="mt-1.5 h-4 w-64" />
      <Skeleton className="mt-6 h-56 w-full rounded-2xl" />
    </div>
  );
}
