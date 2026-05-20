"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { RateCardEntry } from "@/lib/api";
import type { ScheduleDeliverable } from "@/lib/schedule-types";
import { getEffectiveActivityCount } from "@/lib/schedule-effective";
import { ActivityRow } from "./ActivityRow";

export function DeliverableNode(props: {
  deliverable: ScheduleDeliverable;
  fragnetTemplateCount?: number;
  open: boolean;
  onToggle: () => void;
  scenario: "best" | "likely";
  rateCard: RateCardEntry[];
  searchQuery: string;
  highlightActivityId?: string | null;
}) {
  const d = props.deliverable;
  const templateCount = props.fragnetTemplateCount ?? 0;
  const effectiveCount = getEffectiveActivityCount(d, templateCount);
  const q = props.searchQuery.trim().toLowerCase();
  const activities = q
    ? d.activities.filter(
        (a) =>
          a.activityCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q)
      )
    : d.activities;

  if (q && activities.length === 0) return null;

  return (
    <div className="border-l-2 border-slate-200 pl-4 dark:border-slate-700">
      <button
        type="button"
        onClick={props.onToggle}
        className="sticky top-12 z-[5] flex w-full items-center gap-2 rounded-md bg-slate-50/95 px-2 py-1.5 text-left text-sm backdrop-blur dark:bg-slate-900/95"
      >
        {props.open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
        <span className="shrink-0 text-slate-500 dark:text-slate-400">
          ({activities.length}
          {effectiveCount > activities.length ? ` / ${effectiveCount} effective` : ""})
        </span>
      </button>

      {props.open && (
        <div className="mt-2 space-y-2">
          {activities.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">
              {templateCount > 0
                ? `Inherits ${templateCount} default activit${templateCount === 1 ? "y" : "ies"} from fragnet — apply on Fragnets if rows are missing.`
                : "No activities."}
            </div>
          ) : (
            activities.map((a) => (
              <ActivityRow
                key={a.id}
                activity={a}
                scenario={props.scenario}
                rateCard={props.rateCard}
                highlight={props.highlightActivityId === a.id}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
