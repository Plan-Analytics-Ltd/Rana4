"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { RateCardEntry } from "@/lib/api";
import type { ScheduleFragnet } from "@/lib/schedule-types";
import { DeliverableNode } from "./DeliverableNode";

export function FragnetNode(props: {
  fragnet: ScheduleFragnet;
  open: boolean;
  onToggle: () => void;
  deliverableOpen: Record<string, boolean>;
  onDeliverableToggle: (id: string) => void;
  scenario: "best" | "likely";
  rateCard: RateCardEntry[];
  searchQuery: string;
  highlightActivityId?: string | null;
}) {
  const f = props.fragnet;
  const q = props.searchQuery.trim().toLowerCase();
  const visibleDeliverables = q
    ? f.deliverables.filter(
        (d) =>
          d.name.toLowerCase().includes(q) ||
          d.activities.some(
            (a) => a.activityCode.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
          )
      )
    : f.deliverables;

  if (q && visibleDeliverables.length === 0) return null;

  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800">
      <button
        type="button"
        onClick={props.onToggle}
        className="sticky top-0 z-10 flex w-full items-center gap-2 rounded-t-lg bg-slate-100/95 px-3 py-2.5 text-left text-base font-semibold backdrop-blur dark:bg-slate-800/95 dark:text-white"
      >
        {props.open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        <span>{f.name}</span>
        <span className="text-sm font-normal text-slate-500 dark:text-slate-400">
          ({visibleDeliverables.length} deliverables)
        </span>
      </button>

      {props.open && (
        <div className="space-y-3 p-3">
          {visibleDeliverables.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No deliverables.</div>
          ) : (
            visibleDeliverables.map((d) => (
              <DeliverableNode
                key={d.id}
                deliverable={d}
                fragnetTemplateCount={f.activityTemplateCount ?? 0}
                open={props.deliverableOpen[d.id] ?? true}
                onToggle={() => props.onDeliverableToggle(d.id)}
                scenario={props.scenario}
                rateCard={props.rateCard}
                searchQuery={props.searchQuery}
                highlightActivityId={props.highlightActivityId}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
