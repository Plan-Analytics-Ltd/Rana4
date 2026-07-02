"use client";

import { cn } from "@/lib/utils";
import type { DeliverableAttentionLevel, DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

const styles: Record<DeliverableAttentionLevel, string> = {
  aligned: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-200",
  review: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-200",
  high_risk: "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200",
  limited: "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-300",
};

const icons: Record<DeliverableAttentionLevel, string> = {
  aligned: "✓",
  review: "⚠",
  high_risk: "🔴",
  limited: "⚪",
};

type Props = {
  snapshot?: DeliverableStatusSnapshot | null;
  loading?: boolean;
  compact?: boolean;
  onClick?: () => void;
  className?: string;
};

export function DeliverableStatusBadge({ snapshot, loading, compact, onClick, className }: Props) {
  if (loading && !snapshot) {
    return (
      <span className={cn("inline-block h-5 w-16 animate-pulse rounded-full bg-slate-200 dark:bg-slate-700", className)} />
    );
  }
  if (!snapshot) return null;

  const content = (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        styles[snapshot.attention],
        onClick && "cursor-pointer hover:opacity-90",
        className
      )}
    >
      <span aria-hidden>{icons[snapshot.attention]}</span>
      {!compact ? <span>{snapshot.label}</span> : null}
    </span>
  );

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="inline-flex">
        {content}
      </button>
    );
  }
  return content;
}
