"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IntelligenceDriver } from "@/lib/api";

function impactIcon(impact: IntelligenceDriver["impactLevel"]): string {
  if (impact === "HIGH") return "🟠";
  if (impact === "MEDIUM") return "🟡";
  return "🟢";
}

function impactBorder(impact: IntelligenceDriver["impactLevel"]): string {
  if (impact === "HIGH") return "border-orange-200 dark:border-orange-900/50";
  if (impact === "MEDIUM") return "border-amber-200 dark:border-amber-900/50";
  return "border-emerald-200 dark:border-emerald-900/50";
}

function DriverCard({ driver }: { driver: IntelligenceDriver }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-md border px-3 py-2 ${impactBorder(driver.impactLevel)}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{impactIcon(driver.impactLevel)}</span>
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{driver.title}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              impact {driver.impactLevel} · confidence {driver.confidence}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{driver.summary}</p>
        </div>
        {open ? (
          <ChevronDown className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        ) : (
          <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {open ? (
        <div className="mt-2 space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Reasoning
            </div>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-slate-700 dark:text-slate-300">
              {driver.reasoning.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          {driver.evidence.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Evidence
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {driver.evidence.map((e, i) => (
                  <div key={i} className="contents">
                    <dt className="text-slate-500 dark:text-slate-400">{e.label}</dt>
                    <dd className="font-medium text-slate-800 dark:text-slate-200">{String(e.value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DeliverableDriversSection({ drivers }: { drivers: IntelligenceDriver[] }) {
  if (drivers.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        No statistically significant historical drivers identified for this deliverable yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Drivers</div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Associations from comparable historical programmes — not causal recommendations.
      </p>
      {drivers.map((d, i) => (
        <DriverCard key={`${d.driverType}-${i}`} driver={d} />
      ))}
    </div>
  );
}
