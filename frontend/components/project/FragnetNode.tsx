"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import type { RateCardEntry } from "@/lib/api";
import type { ScheduleFragnet } from "@/lib/schedule-types";
import { DeliverableNode } from "./DeliverableNode";
import { SharedActivitiesSection } from "./SharedActivitiesSection";
import { isProjectLevelGroupName } from "@/lib/schedule-types";
import { collectFragnetSharedActivities } from "@/lib/schedule-workspace-data";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

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
  deliverableIntelById?: Map<string, DeliverableStatusSnapshot>;
  onDeliverableIntelClick?: (deliverableId: string, deliverableName: string) => void;
}) {
  const f = props.fragnet;
  const sharedActivities = collectFragnetSharedActivities(f);
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

  if (isProjectLevelGroupName(f.name)) {
    return (
      <div className="space-y-3">
        {sharedActivities.length > 0 ? (
          <SharedActivitiesSection
            activities={sharedActivities}
            scenario={props.scenario}
            rateCard={props.rateCard}
            highlightActivityId={props.highlightActivityId}
          />
        ) : null}
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
              intelSnapshot={props.deliverableIntelById?.get(d.id)}
              onIntelClick={
                props.onDeliverableIntelClick
                  ? () => props.onDeliverableIntelClick!(d.id, d.name)
                  : undefined
              }
            />
          ))
        )}
      </div>
    );
  }

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
          {sharedActivities.length > 0 ? (
            <SharedActivitiesSection
              activities={sharedActivities}
              scenario={props.scenario}
              rateCard={props.rateCard}
              highlightActivityId={props.highlightActivityId}
            />
          ) : null}
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
                intelSnapshot={props.deliverableIntelById?.get(d.id)}
                onIntelClick={
                  props.onDeliverableIntelClick
                    ? () => props.onDeliverableIntelClick!(d.id, d.name)
                    : undefined
                }
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
