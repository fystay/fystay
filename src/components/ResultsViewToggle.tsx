"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { List, Map } from "lucide-react";
import { parseViewParam } from "@/lib/listingSearch";
import { cn } from "@/lib/cn";

export function ResultsViewToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = parseViewParam(searchParams.get("view") ?? undefined);

  function setView(next: "list" | "map") {
    const params = new URLSearchParams(searchParams.toString());
    if (next === "list") params.delete("view");
    else params.set("view", next);
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  }

  return (
    <div
      role="group"
      aria-label="Results view"
      className="flex shrink-0 items-center gap-0.5 rounded-full border border-border-subtle p-0.5"
    >
      {(
        [
          { key: "list" as const, label: "List", icon: List },
          { key: "map" as const, label: "Map", icon: Map },
        ]
      ).map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          aria-pressed={view === key}
          onClick={() => setView(key)}
          className={cn(
            "focus-ring flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition-colors",
            view === key
              ? "bg-brand-700 text-white"
              : "text-stone-600 hover:bg-surface-muted",
          )}
        >
          <Icon className="h-4 w-4" aria-hidden />
          {/* Icon only on phones, so the results toolbar fits one row. */}
          <span className="sr-only sm:not-sr-only">{label}</span>
        </button>
      ))}
    </div>
  );
}
