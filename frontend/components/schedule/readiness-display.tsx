"use client";

import type { ReadinessResult } from "@/lib/schedule-validation";
import { cn } from "@/lib/utils";

const bandStyles: Record<string, { ring: string; text: string; sub: string }> = {
  excellent: {
    ring: "border-emerald-500",
    text: "text-emerald-700 dark:text-emerald-300",
    sub: "text-emerald-600/80 dark:text-emerald-400/80",
  },
  good: {
    ring: "border-cyan-500",
    text: "text-cyan-700 dark:text-cyan-300",
    sub: "text-cyan-600/80 dark:text-cyan-400/80",
  },
  usable: {
    ring: "border-amber-500",
    text: "text-amber-700 dark:text-amber-300",
    sub: "text-amber-600/80 dark:text-amber-400/80",
  },
  risky: {
    ring: "border-orange-500",
    text: "text-orange-700 dark:text-orange-300",
    sub: "text-orange-600/80 dark:text-orange-400/80",
  },
  unstable: {
    ring: "border-red-500",
    text: "text-red-700 dark:text-red-300",
    sub: "text-red-600/80 dark:text-red-400/80",
  },
};

const bandHint: Record<string, string> = {
  excellent: "Structurally sound — ready for export",
  good: "Healthy schedule — minor items may remain",
  usable: "Exportable with attention to warnings",
  risky: "Structural issues need review before export",
  unstable: "Critical problems — fix before exporting",
};

export function ReadinessDisplay(props: {
  readiness: ReadinessResult;
  size?: "sm" | "md";
  className?: string;
}) {
  const { readiness, size = "md", className } = props;
  const style = bandStyles[readiness.band] ?? bandStyles.usable;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "flex flex-col items-center justify-center rounded-full border-4 text-center",
            style.ring,
            size === "sm" ? "h-16 w-16" : "h-20 w-20"
          )}
        >
          <span className={cn("font-bold", style.text, size === "sm" ? "text-xl" : "text-2xl")}>
            {readiness.score}%
          </span>
        </div>
        <div>
          <p className={cn("font-semibold", style.text, size === "sm" ? "text-base" : "text-lg")}>
            {readiness.label}
          </p>
          <p className={cn("text-xs", style.sub)}>{bandHint[readiness.band] ?? bandHint.usable}</p>
        </div>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        {readiness.critical > 0 && (
          <span className="text-red-600 dark:text-red-400">{readiness.critical} critical</span>
        )}
        {readiness.critical > 0 && readiness.warning > 0 && " · "}
        {readiness.warning > 0 && (
          <span className="text-amber-600 dark:text-amber-400">{readiness.warning} warnings</span>
        )}
        {(readiness.critical > 0 || readiness.warning > 0) && readiness.advisory > 0 && " · "}
        {readiness.advisory > 0 && <span>{readiness.advisory} advisory</span>}
        {(readiness.critical > 0 || readiness.warning > 0 || readiness.advisory > 0) &&
          readiness.info > 0 &&
          " · "}
        {readiness.info > 0 && <span>{readiness.info} info</span>}
        {readiness.critical === 0 &&
          readiness.warning === 0 &&
          readiness.advisory === 0 &&
          readiness.info === 0 &&
          "No issues"}
      </p>
    </div>
  );
}
