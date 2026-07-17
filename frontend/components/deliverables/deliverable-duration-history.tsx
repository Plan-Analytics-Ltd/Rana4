"use client";

import { Loader2 } from "lucide-react";

export type HistoricalDurationSummary = {
  available: boolean;
  projectsUsed: number;
  sampleCount: number;
  minimumDays: number | null;
  averageDays: number | null;
  maximumDays: number | null;
};

type Props = {
  deliverableName: string;
  statistics: HistoricalDurationSummary | null;
  contributingProjects?: Array<{ projectId: string; projectName: string }>;
  unavailableReason?: string | null;
  loading?: boolean;
};

const metrics = [
  {
    key: "minimumDays" as const,
    label: "Minimum",
    className:
      "border-emerald-200/70 bg-emerald-50/60 text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/20 dark:text-emerald-100",
  },
  {
    key: "averageDays" as const,
    label: "Average",
    className:
      "border-amber-200/70 bg-amber-50/60 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-100",
  },
  {
    key: "maximumDays" as const,
    label: "Maximum",
    className:
      "border-rose-200/70 bg-rose-50/60 text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-100",
  },
];

function formatDays(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  return `${Math.max(1, Math.round(value))} days`;
}

export function DeliverableDurationHistory({
  deliverableName,
  statistics,
  contributingProjects = [],
  unavailableReason,
  loading = false,
}: Props) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50/60 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:bg-slate-900/40">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Checking previous projects…
      </div>
    );
  }

  if (!statistics?.available || statistics.projectsUsed < 1) {
    if (!unavailableReason) return null;
    return (
      <section className="rounded-md border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
          Previous Projects
        </h4>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          No planning information from previous projects is available yet for this deliverable.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-md border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-900/30">
      <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
        Previous Projects
      </h4>
      <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-200">{deliverableName}</p>
      <div className="mt-2">
        <p className="text-xs font-medium text-slate-500 dark:text-slate-400">Based on</p>
        <ul className="mt-1 space-y-0.5 text-sm text-slate-700 dark:text-slate-200">
          {contributingProjects.map((project) => (
            <li key={project.projectId}>{project.projectName}</li>
          ))}
        </ul>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2">
        {metrics.map((metric) => (
          <div key={metric.key} className={`rounded-md border px-2.5 py-2 ${metric.className}`}>
            <dt className="text-[10px] font-medium uppercase tracking-wide opacity-75">
              {metric.label}
            </dt>
            <dd className="mt-0.5 text-sm font-semibold">
              {formatDays(statistics[metric.key])}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
