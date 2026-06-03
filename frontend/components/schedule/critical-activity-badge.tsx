"use client";

import { cn } from "@/lib/utils";

export function CriticalActivityBadge(props: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800 dark:bg-red-950/50 dark:text-red-200",
        props.className
      )}
      title="On critical path (total float = 0)"
    >
      Critical
    </span>
  );
}

export function formatScheduleDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  return d;
}
