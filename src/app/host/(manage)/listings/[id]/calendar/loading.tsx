import { Skeleton } from "@/components/ui/Skeleton";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="mt-3 h-7 w-56" />
      <Skeleton className="mt-1.5 h-4 w-72" />
      <Skeleton className="mt-6 h-[28rem] w-full rounded-2xl" />
    </div>
  );
}
