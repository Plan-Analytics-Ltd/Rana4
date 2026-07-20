"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeliverableDurationStatisticsItem } from "@/lib/api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deliverableName: string;
  history: DeliverableDurationStatisticsItem | null;
};

const statistics = [
  { key: "minimumDays" as const, label: "Minimum" },
  { key: "averageDays" as const, label: "Average" },
  { key: "maximumDays" as const, label: "Maximum" },
];

function formatDays(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Math.max(1, Math.round(value))} days`;
}

export function HistoricalPlanningDialog({
  open,
  onOpenChange,
  deliverableName,
  history,
}: Props) {
  const projects = history?.contributingProjects ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Previous Projects</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Deliverable</p>
            <p className="mt-1 font-medium text-slate-900 dark:text-white">{deliverableName}</p>
          </div>

          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            These planning durations are based on {projects.length} previously imported project
            {projects.length === 1 ? "" : "s"} containing equivalent {deliverableName} work.
          </p>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Projects used</p>
            <ul className="mt-2 divide-y divide-slate-200 rounded-md border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
              {projects.map((project) => (
                <li key={project.projectId} className="space-y-3 p-3">
                  <p className="font-semibold text-slate-900 dark:text-white">{project.projectName}</p>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1 text-sm">
                    {project.fragnetName ? (
                      <>
                        <dt className="text-slate-500">Fragnet</dt>
                        <dd className="text-slate-800 dark:text-slate-200">
                          {project.fragnetName}
                        </dd>
                      </>
                    ) : null}
                    <dt className="text-slate-500">Deliverable</dt>
                    <dd className="text-slate-800 dark:text-slate-200">
                      {project.matchedDeliverableName}
                    </dd>
                    <dt className="text-slate-500">Planning</dt>
                    <dd className="font-medium text-slate-900 dark:text-white">
                      {formatDays(project.planningDurationDays)}
                    </dd>
                  </dl>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Planning summary
            </p>
            <dl className="mt-2 grid grid-cols-3 gap-2">
              {statistics.map((statistic) => (
                <div
                  key={statistic.key}
                  className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40"
                >
                  <dt className="text-xs text-slate-500">{statistic.label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                    {formatDays(history?.statistics[statistic.key] ?? null)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
