"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  intelligenceApi,
  getApiErrorMessage,
  type IntelligenceFinding,
  type IntelligenceDriver,
} from "@/lib/api";
import { DeliverableFindingsSection } from "@/components/deliverables/deliverable-findings-section";
import { DeliverableDriversSection } from "@/components/deliverables/deliverable-drivers-section";

type Props = {
  projectId: string;
  deliverableId: string;
  /** When false, skips network requests (e.g. dialog closed). */
  enabled?: boolean;
  /** Bump after saves to force a fresh load when re-opened. */
  refreshKey?: number;
};

type Status = "NORMAL" | "SLIGHTLY_HIGH" | "HIGH" | "RED_FLAG" | "EXTREME_OUTLIER";

function statusVariant(s: Status): "default" | "secondary" | "destructive" | "outline" {
  if (s === "RED_FLAG" || s === "EXTREME_OUTLIER") return "destructive";
  if (s === "HIGH") return "default";
  if (s === "SLIGHTLY_HIGH") return "secondary";
  return "outline";
}

export function DeliverableBenchmarkPanel({
  projectId,
  deliverableId,
  enabled = true,
  refreshKey = 0,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [findings, setFindings] = useState<IntelligenceFinding[]>([]);
  const [drivers, setDrivers] = useState<IntelligenceDriver[]>([]);

  useEffect(() => {
    if (!enabled || !projectId || !deliverableId) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const [benchRes, findingsRes, driversRes] = await Promise.all([
          intelligenceApi.getDeliverableBenchmark(projectId, deliverableId),
          intelligenceApi.getDeliverableFindings(projectId, deliverableId),
          intelligenceApi.getDeliverableDrivers(projectId, deliverableId),
        ]);
        if (!cancelled) {
          setData(benchRes.data);
          setFindings(findingsRes.data.findings ?? []);
          setDrivers(driversRes.data.drivers ?? []);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(getApiErrorMessage(e) || "Failed to load benchmark");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, deliverableId, enabled, refreshKey]);

  const benchmark = data?.benchmark;
  const outlier = data?.outlier;
  const evidence = data?.evidence;

  const status: Status = outlier?.status ?? "NORMAL";
  const current = outlier?.currentDurationDays ?? null;
  const avg = benchmark?.averageDuration ?? null;
  const med = benchmark?.medianDuration ?? null;
  const min = benchmark?.minimumDuration ?? null;
  const max = benchmark?.maximumDuration ?? null;
  const sampleSize = benchmark?.sampleSize ?? 0;
  const diffAvg = outlier?.differenceFromAveragePercent ?? null;
  const confidenceLevel = benchmark?.confidenceLevel ?? null;
  const confidenceScore = benchmark?.confidenceScore ?? null;
  const notes: string[] = benchmark?.notes ?? [];
  const sampleTier = benchmark?.sampleSizeConfidenceTier ?? null;
  const avgProjSim = benchmark?.benchmarkQuality?.averageProjectSimilarity ?? null;

  const subtitle = useMemo(() => {
    if (sampleSize > 0) return `Based on ${sampleSize} comparable deliverables`;
    return "No comparable historical deliverables found (stable snapshots only)";
  }, [sampleSize]);

  return (
    <Card className="border-slate-200 dark:border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Benchmark & red flag</CardTitle>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          {confidenceLevel ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Confidence: <span className="font-medium">{confidenceLevel}</span>
              {confidenceScore != null ? <span className="text-slate-500"> ({confidenceScore})</span> : null}
              {sampleTier ? <span className="text-slate-500"> · sample tier {sampleTier}</span> : null}
              {avgProjSim != null ? <span className="text-slate-500"> · avg project similarity {avgProjSim}%</span> : null}
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading benchmark…
          </div>
        ) : err ? (
          <div className="text-sm text-red-600">{err}</div>
        ) : (
          <>
            {confidenceLevel === "LOW" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                Limited historical evidence. Use benchmark as guidance only.
              </div>
            ) : null}

            {notes.length > 0 ? (
              <div className="space-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/20 dark:text-slate-300">
                {notes.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </div>
            ) : null}

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Current</div>
                <div className="font-semibold">{current != null ? `${current} days` : "—"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Difference vs Avg</div>
                <div className="font-semibold">{diffAvg != null ? `+${diffAvg}%` : "—"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Historical Min</div>
                <div className="font-semibold">{min != null ? `${min}` : "—"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Historical Max</div>
                <div className="font-semibold">{max != null ? `${max}` : "—"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Historical Avg</div>
                <div className="font-semibold">{avg != null ? `${avg}` : "—"}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2 dark:bg-slate-900/40">
                <div className="text-xs text-slate-500 dark:text-slate-400">Historical Median</div>
                <div className="font-semibold">{med != null ? `${med}` : "—"}</div>
              </div>
            </div>

            {sampleSize > 0 && (
              <button
                type="button"
                className="flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/30"
                onClick={() => setOpen((v) => !v)}
              >
                <span className="font-medium">Evidence</span>
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
            )}

            {open && sampleSize > 0 ? (
              <div className="space-y-2 rounded-md border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  Matched deliverables (showing up to {Math.min(20, evidence?.matchedDeliverables?.length ?? 0)})
                </div>
                <ul className="space-y-1">
                  {(evidence?.matchedDeliverables ?? []).slice(0, 20).map((m: any, idx: number) => (
                    <li key={idx} className="flex flex-col gap-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{m.projectName}</span>
                        <span className="text-slate-500 dark:text-slate-400">—</span>
                        <span>{m.deliverableName}</span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {m.programmeState ?? "UNKNOWN"} · {m.durationDays} days · similarity {m.similarityScore}%
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <DeliverableFindingsSection findings={findings} />
            <DeliverableDriversSection drivers={drivers} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

