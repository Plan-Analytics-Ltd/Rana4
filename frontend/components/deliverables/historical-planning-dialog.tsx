"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DeliverableDurationStatisticsItem } from "@/lib/api";
import { LOW_NAME_CONSISTENCY_THRESHOLD } from "@/lib/api";

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

function formatSimilarity(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export function HistoricalPlanningDialog({
  open,
  onOpenChange,
  deliverableName,
  history,
}: Props) {
  const projects = history?.contributingProjects ?? [];
  const showDiagnostics = process.env.NODE_ENV !== "production";

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
                      <span>{project.matchedDeliverableName}</span>
                      {typeof project.nameSimilarity === "number" ? (
                        <span
                          className={
                            project.nameSimilarity < LOW_NAME_CONSISTENCY_THRESHOLD
                              ? "ml-2 text-xs font-medium text-amber-700 dark:text-amber-300"
                              : "ml-2 text-xs text-slate-500 dark:text-slate-400"
                          }
                        >
                          {project.nameSimilarity < LOW_NAME_CONSISTENCY_THRESHOLD
                            ? `low similarity (${formatSimilarity(project.nameSimilarity)})`
                            : `${formatSimilarity(project.nameSimilarity)} name match`}
                        </span>
                      ) : null}
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

          {showDiagnostics && (history?.projectDiagnostics.length ?? 0) > 0 ? (
            <details className="rounded-md border border-dashed border-slate-300 p-3 dark:border-slate-700">
              <summary className="cursor-pointer text-sm font-medium text-slate-700 dark:text-slate-200">
                Why these projects?
              </summary>
              <div className="mt-3 space-y-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Projects considered
                </p>
                <ul className="divide-y divide-slate-200 text-sm dark:divide-slate-700">
                  {history?.projectDiagnostics.map((project) => {
                    const reason =
                      project.reason === "USED"
                        ? "Used — equivalent work with a planning duration"
                        : project.reason === "NO_EQUIVALENT_DELIVERABLE"
                          ? `No equivalent ${deliverableName} found`
                          : project.reason === "NO_PLANNING_DURATION"
                            ? "Equivalent work found, but no planning duration was available"
                            : "Not used because a closer comparison was available";
                    return (
                      <li key={project.projectId} className="py-2">
                        <p className="font-medium text-slate-800 dark:text-slate-100">
                          {project.used ? "✓" : "✕"} {project.projectName}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">{reason}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </details>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
