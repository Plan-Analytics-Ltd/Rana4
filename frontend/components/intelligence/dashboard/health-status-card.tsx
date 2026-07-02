"use client";

import { cn } from "@/lib/utils";

type Props = {
  title: string;
  description: string;
  status: "good" | "moderate" | "limited";
  className?: string;
};

const statusStyles = {
  good: "border-emerald-200 bg-emerald-50/80 text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-200",
  moderate: "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200",
  limited: "border-slate-200 bg-slate-50/80 text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
};

export function HealthStatusCard({ title, description, status, className }: Props) {
  return (
    <div className={cn("rounded-lg border p-4", statusStyles[status], className)}>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-sm opacity-90">{description}</p>
    </div>
  );
}
