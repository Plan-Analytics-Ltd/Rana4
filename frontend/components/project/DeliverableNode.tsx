"use client";

import { ChevronDown, ChevronRight, GitBranch } from "lucide-react";
import { formatDeliverableRelationshipSummary } from "@/lib/schedule-workspace-data";
import type { RateCardEntry } from "@/lib/api";
import type { ScheduleDeliverable } from "@/lib/schedule-types";
import { ActivityRow } from "./ActivityRow";
import { DeliverableStatusBadge } from "@/components/intelligence/deliverable-status-badge";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

export function DeliverableNode(props: {
  deliverable: ScheduleDeliverable;
  fragnetTemplateCount?: number;
  open: boolean;
  onToggle: () => void;
  scenario: "best" | "likely";
  rateCard: RateCardEntry[];
  searchQuery: string;
  highlightActivityId?: string | null;
  intelSnapshot?: DeliverableStatusSnapshot;
  onIntelClick?: () => void;
}) {
  const d = props.deliverable;
  const q = props.searchQuery.trim().toLowerCase();
  const linkedActivities = d.activities.filter((a) => !a.isSharedAcrossDeliverables);
  const activities = q
    ? linkedActivities.filter(
        (a) =>
          a.activityCode.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          (a.linkedDeliverables ?? []).some((linked) => linked.name.toLowerCase().includes(q))
      )
    : linkedActivities;

  if (q && activities.length === 0) return null;

  const relSummary = formatDeliverableRelationshipSummary(d.relationships, activities.length);
  const hasLogic = relSummary !== "—" && !relSummary.endsWith(" act");

  return (
    <div className="border-l-2 border-slate-200 pl-4 dark:border-slate-700">
      <button
        type="button"
        onClick={props.onToggle}
        className="sticky top-12 z-[5] flex w-full items-center gap-2 rounded-md bg-slate-50/95 px-2 py-1.5 text-left text-sm backdrop-blur dark:bg-slate-900/95"
      >
        {props.open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 truncate font-medium text-slate-800 dark:text-slate-100">{d.name}</span>
        <DeliverableStatusBadge
          snapshot={props.intelSnapshot}
          compact
          onClick={props.onIntelClick}
        />
        <span className="shrink-0 text-slate-500 dark:text-slate-400">({activities.length})</span>
        {hasLogic ? (
          <span
            className="inline-flex max-w-[min(100%,14rem)] shrink items-center gap-1 truncate rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/40 dark:text-violet-200"
            title={relSummary}
          >
            <GitBranch className="h-3 w-3 shrink-0" />
            {relSummary}
          </span>
        ) : null}
      </button>

      {props.open && (
        <div className="mt-2 space-y-2">
          {activities.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No activities.</div>
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
