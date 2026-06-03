"use client";

import { GitBranch, Users, Clock, PoundSterling } from "lucide-react";
import type { RateCardEntry } from "@/lib/api";
import { activityMetrics } from "@/lib/schedule-metrics";
import type { ScheduleActivity } from "@/lib/schedule-types";
import { rateCardLookup } from "@/lib/schedule-types";
import { cn } from "@/lib/utils";

export function ActivityRow(props: {
  activity: ScheduleActivity;
  scenario?: "best" | "likely";
  rateCard?: RateCardEntry[];
  highlight?: boolean;
}) {
  const { activity: a, scenario = "best", rateCard = [], highlight } = props;
  const lookup = rateCardLookup(rateCard);
  const m = activityMetrics(a, scenario, lookup);
  const days = scenario === "best" ? a.bestDuration : a.likelyDuration;
  const hasDuration = Number.isFinite(days) && days > 0;
  const fmtLag = (lag: number) => (lag === 0 ? "" : lag > 0 ? ` +${lag}d` : ` ${lag}d`);
  const fmtRel = (r: { activityCode: string; deliverableName?: string; relationshipType: string; lag: number }) => {
    const label = r.deliverableName ? `Deliverable ${r.deliverableName}` : r.activityCode;
    return `${label} (${r.relationshipType}${fmtLag(r.lag)})`;
  };

  return (
    <div
      className={cn(
        "rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-sm transition-colors dark:border-slate-800 dark:bg-slate-950",
        highlight && "border-cyan-400 ring-1 ring-cyan-400/40",
        !hasDuration && "border-amber-300 dark:border-amber-700"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs font-semibold text-slate-800 dark:bg-slate-800 dark:text-slate-200">
              {a.activityCode}
            </span>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-medium",
                hasDuration
                  ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                  : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"
              )}
            >
              {hasDuration ? `${days}d` : "No duration"}
            </span>
            {a.isSharedAcrossDeliverables ? (
              <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
                Shared by {Math.max(1, a.linkedDeliverables?.length ?? 1)} deliverable
                {Math.max(1, a.linkedDeliverables?.length ?? 1) === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 font-medium text-slate-900 dark:text-white">{a.name}</p>
          {a.isSharedAcrossDeliverables && (a.linkedDeliverables?.length ?? 0) > 0 ? (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Linked deliverables: {a.linkedDeliverables?.map((d) => d.name).join(", ")}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {m.predCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
              <GitBranch className="h-3 w-3" /> {m.predCount} pred
            </span>
          )}
          {m.succCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200">
              <GitBranch className="h-3 w-3" /> {m.succCount} succ
            </span>
          )}
          {m.resourceCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-cyan-100 px-2 py-0.5 text-xs text-cyan-800 dark:bg-cyan-900/40 dark:text-cyan-200">
              <Users className="h-3 w-3" /> {m.resourceCount}
            </span>
          )}
          {m.totalCost > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700 dark:bg-slate-800 dark:text-slate-300">
              <PoundSterling className="h-3 w-3" /> {m.totalCost.toLocaleString()}
            </span>
          )}
          {m.totalHours > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              <Clock className="h-3 w-3" /> {m.totalHours}h
            </span>
          )}
        </div>
      </div>

      {(a.relationships.predecessors.length > 0 || a.relationships.successors.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-400">
          {a.relationships.predecessors.length > 0 && (
            <span>
              <span className="font-medium text-slate-500">Pred:</span>{" "}
              {a.relationships.predecessors.map((r) => fmtRel(r)).join(", ")}
            </span>
          )}
          {a.relationships.successors.length > 0 && (
            <span>
              <span className="font-medium text-slate-500">Succ:</span>{" "}
              {a.relationships.successors.map((r) => fmtRel(r)).join(", ")}
            </span>
          )}
        </div>
      )}

      {a.assignedResources.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {a.assignedResources.map((r, idx) => (
            <li
              key={`${r.resourceName}-${idx}`}
              className="rounded border border-slate-100 bg-slate-50 px-2 py-0.5 text-xs dark:border-slate-800 dark:bg-slate-900"
            >
              {r.resourceName}
              {r.units != null ? ` · ${r.units} units` : ""}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
