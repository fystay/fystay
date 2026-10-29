import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";

export function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
  className,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  sublabel?: string;
  className?: string;
}) {
  return (
    <Card className={cn("flex items-start gap-3 p-4", className)}>
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        <Icon className="h-4.5 w-4.5" />
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{label}</p>
        <p className="mt-0.5 truncate text-xl font-bold text-foreground">{value}</p>
        {sublabel && <p className="mt-0.5 line-clamp-2 text-xs text-stone-500">{sublabel}</p>}
      </div>
    </Card>
  );
}
