"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IntelligenceFinding } from "@/lib/api";

function severityIcon(severity: IntelligenceFinding["severity"]): string {
  if (severity === "HIGH") return "🔴";
  if (severity === "MEDIUM") return "🟡";
  return "🟢";
}

function severityBorder(severity: IntelligenceFinding["severity"]): string {
  if (severity === "HIGH") return "border-red-200 dark:border-red-900/50";
  if (severity === "MEDIUM") return "border-amber-200 dark:border-amber-900/50";
  return "border-emerald-200 dark:border-emerald-900/50";
}

function FindingCard({ finding }: { finding: IntelligenceFinding }) {
  const [open, setOpen] = useState(false);

  return (
    <div className={`rounded-md border px-3 py-2 ${severityBorder(finding.severity)}`}>
      <button
        type="button"
        className="flex w-full items-start justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span aria-hidden>{severityIcon(finding.severity)}</span>
            <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{finding.title}</span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {finding.severity} · confidence {finding.confidence}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{finding.summary}</p>
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
              {finding.reasoning.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          </div>
          {finding.evidence.length > 0 ? (
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Evidence
              </div>
              <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {finding.evidence.map((e, i) => (
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

export function DeliverableFindingsSection({ findings }: { findings: IntelligenceFinding[] }) {
  if (findings.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        No structured findings for this deliverable yet.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">Findings</div>
      {findings.map((f, i) => (
        <FindingCard key={`${f.findingType}-${i}`} finding={f} />
      ))}
    </div>
  );
}
