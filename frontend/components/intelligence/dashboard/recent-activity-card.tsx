"use client";

import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle: string;
  date: string;
  className?: string;
};

export function RecentActivityCard({ title, subtitle, date, className }: Props) {
  return (
    <div className={cn("flex gap-3 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50", className)}>
      <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-800">
        <Calendar className="h-4 w-4 text-slate-600 dark:text-slate-300" />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
        <p className="mt-1 text-xs text-slate-400">{date}</p>
      </div>
    </div>
  );
}
