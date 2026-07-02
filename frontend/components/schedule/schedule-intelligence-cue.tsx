"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Lightbulb, ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";
import { scheduleTooltipForSnapshot } from "@/lib/deliverable-intelligence-status";

type Props = {
  snapshot?: DeliverableStatusSnapshot | null;
  onClick?: () => void;
  className?: string;
};

export function ScheduleIntelligenceCue({ snapshot, onClick, className }: Props) {
  if (!snapshot) return null;

  const tooltip = scheduleTooltipForSnapshot(snapshot);
  const needsReview = snapshot.attention === "review" || snapshot.attention === "high_risk";
  const hasRecommendation = snapshot.recommendationCount > 0;
  const limited = snapshot.attention === "limited";

  if (!needsReview && !hasRecommendation && !limited) return null;

  const wrap = (node: ReactNode, title: string) => (
    <button
      type="button"
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick?.();
      }}
      className={cn("inline-flex shrink-0 rounded p-0.5 hover:bg-slate-200/80 dark:hover:bg-slate-700/80", onClick && "cursor-pointer")}
    >
      {node}
    </button>
  );

  return (
    <span className={cn("ml-1 inline-flex items-center gap-0.5", className)}>
      {needsReview
        ? wrap(
            <AlertTriangle
              className={cn(
                "h-3 w-3",
                snapshot.attention === "high_risk" ? "text-red-500" : "text-amber-500"
              )}
            />,
            tooltip ?? "Historical evidence suggests review."
          )
        : null}
      {hasRecommendation
        ? wrap(<Lightbulb className="h-3 w-3 text-violet-500" />, "Recommendations available for this deliverable.")
        : null}
      {limited && !needsReview
        ? wrap(<ShieldQuestion className="h-3 w-3 text-slate-400" />, tooltip ?? "Limited historical evidence.")
        : null}
    </span>
  );
}
