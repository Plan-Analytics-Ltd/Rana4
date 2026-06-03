"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { RateCardEntry } from "@/lib/api";
import type { ScheduleActivity } from "@/lib/schedule-types";
import { ActivityRow } from "./ActivityRow";

function SharedActivityNode(props: {
  activity: ScheduleActivity;
  scenario: "best" | "likely";
  rateCard: RateCardEntry[];
  highlight?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? true);
  const linked = (props.activity.linkedDeliverables ?? []).filter((d) => d.name);

  return (
    <div className="rounded-lg border border-cyan-200/80 bg-cyan-50/40 dark:border-cyan-900/50 dark:bg-cyan-950/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-t-lg px-2 py-1.5 text-left text-sm font-medium text-cyan-950 dark:text-cyan-100"
      >
        {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
        <span className="min-w-0 truncate">{props.activity.name}</span>
        {!open && linked.length > 0 ? (
          <span className="ml-auto shrink-0 text-xs font-normal text-slate-500 dark:text-slate-400">
            {linked.length} deliverable{linked.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="space-y-2 border-t border-cyan-200/60 px-2 py-2 dark:border-cyan-900/40">
          <ActivityRow
            activity={props.activity}
            scenario={props.scenario}
            rateCard={props.rateCard}
            highlight={props.highlight}
          />
          {linked.length > 0 ? (
            <div className="border-l-2 border-cyan-300/80 pl-3 dark:border-cyan-800">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Shared by
              </p>
              <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
                {linked.map((d) => (
                  <li key={d.id}>{d.name}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SharedActivitiesSection(props: {
  activities: ScheduleActivity[];
  scenario: "best" | "likely";
  rateCard: RateCardEntry[];
  highlightActivityId?: string | null;
}) {
  if (props.activities.length === 0) return null;

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/50 dark:border-cyan-900/60 dark:bg-cyan-950/25">
      <div className="border-b border-cyan-200/80 px-3 py-2 text-sm font-semibold text-cyan-950 dark:border-cyan-900/50 dark:text-cyan-100">
        Shared Activities
      </div>
      <div className="space-y-2 p-3">
        {props.activities.map((a) => (
          <SharedActivityNode
            key={a.id}
            activity={a}
            scenario={props.scenario}
            rateCard={props.rateCard}
            highlight={props.highlightActivityId === a.id}
          />
        ))}
      </div>
    </div>
  );
}
