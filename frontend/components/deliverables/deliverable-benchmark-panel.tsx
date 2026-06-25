"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  intelligenceApi,
  getApiErrorMessage,
  type BenchmarkOutlierStatus,
  type DeliverableAnalysisCore,
  type IntelligenceFinding,
  type IntelligenceDriver,
  type IntelligenceRecommendation,
  type IntelligenceTrustExplanation,
} from "@/lib/api";
import { DeliverableFindingsSection } from "@/components/deliverables/deliverable-findings-section";
import { DeliverableDriversSection } from "@/components/deliverables/deliverable-drivers-section";
import { DeliverableRecommendationsSection } from "@/components/deliverables/deliverable-recommendations-section";
import { DeliverableTrustSection } from "@/components/deliverables/deliverable-trust-section";
import { DeliverableExplanationPanel } from "@/components/deliverables/deliverable-explanation-panel";

type Props = {
  projectId: string;
  deliverableId: string;
  enabled?: boolean;
  refreshKey?: number;
};

type Status = BenchmarkOutlierStatus;

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
  const [data, setData] = useState<DeliverableAnalysisCore | null>(null);
  const [findings, setFindings] = useState<IntelligenceFinding[]>([]);
  const [drivers, setDrivers] = useState<IntelligenceDriver[]>([]);
  const [recommendations, setRecommendations] = useState<IntelligenceRecommendation[]>([]);
  const [trust, setTrust] = useState<IntelligenceTrustExplanation | null>(null);

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
        const { data: analysis } = await intelligenceApi.getDeliverableIntelligenceAnalysis(
          projectId,
          deliverableId
        );
        if (!cancelled) {
          setData({
            deliverable: analysis.deliverable,
            currentDurationDays: analysis.currentDurationDays,
            benchmark: analysis.benchmark,
            outlier: analysis.outlier,
            evidence: analysis.evidence,
          });
          setFindings(analysis.observations ?? []);
          setDrivers(analysis.keyFactors ?? []);
          setRecommendations(analysis.recommendations ?? []);
          setTrust(analysis.trust ?? null);
        }
      } catch (e: unknown) {
        if (!cancelled) setErr(getApiErrorMessage(e) || "Failed to load comparison");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, deliverableId, enabled, refreshKey]);

  const benchmark = data?.benchmark;
  const expected = benchmark?.expectedDuration;
  const reliability = benchmark?.forecastReliability;
  const predicted = benchmark?.predictedOutcome;
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
    const expectedCount = expected?.evidenceCount ?? 0;
    if (expectedCount > 0) {
      return `Based on ${expectedCount} comparable deliverable${expectedCount === 1 ? "" : "s"}`;
    }
    if (sampleSize > 0) return `Based on ${sampleSize} comparable deliverables`;
    return "No comparable historical deliverables found yet";
  }, [expected?.evidenceCount, sampleSize]);

  return (
    <Card className="border-slate-200 dark:border-slate-700">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Comparison</CardTitle>
          <Badge variant={statusVariant(status)}>{status}</Badge>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
          {expected?.maturityLabel ? (
            <p className="text-xs font-medium text-slate-700 dark:text-slate-200">{expected.maturityLabel}</p>
          ) : null}
          {confidenceLevel ? (
            <p className="text-xs text-slate-600 dark:text-slate-300">
              Confidence: <span className="font-medium">{expected?.confidenceLevel ?? confidenceLevel}</span>
              {(expected?.confidenceScore ?? confidenceScore) != null ? (
                <span className="text-slate-500"> ({expected?.confidenceScore ?? confidenceScore})</span>
              ) : null}
              {sampleTier ? <span className="text-slate-500"> · evidence tier {sampleTier}</span> : null}
              {avgProjSim != null ? <span className="text-slate-500"> · avg project similarity {avgProjSim}%</span> : null}
            </p>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading comparison…
          </div>
        ) : err ? (
          <div className="text-sm text-red-600">{err}</div>
        ) : (
          <>
            <DeliverableTrustSection trust={trust} />

            <DeliverableExplanationPanel
              projectId={projectId}
              deliverableId={deliverableId}
              enabled={enabled && !loading && !err}
            />

            {(expected?.confidenceLevel === "LOW" || confidenceLevel === "LOW") && sampleSize + (expected?.evidenceCount ?? 0) > 0 ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                Limited historical evidence. Use these figures as guidance only.
              </div>
            ) : null}

            {expected?.rangeLabel ? (
              <div className="grid gap-3 rounded-lg border border-cyan-200/60 bg-cyan-50/50 p-3 dark:border-cyan-900/40 dark:bg-cyan-950/20 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Expected duration
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{expected.rangeLabel}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Most likely
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {expected.mostLikelyDays != null ? `${expected.mostLikelyDays} Days` : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Confidence</div>
                  <div className="font-medium">{expected.confidenceLevel ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Evidence</div>
                  <div className="font-medium">
                    {expected.evidenceCount ?? 0} Comparable Deliverable{(expected.evidenceCount ?? 0) === 1 ? "" : "s"}
                  </div>
                </div>
              </div>
            ) : null}

            {reliability?.reliabilityLabel ? (
              <div className="grid gap-3 rounded-lg border border-violet-200/60 bg-violet-50/50 p-3 dark:border-violet-900/40 dark:bg-violet-950/20 sm:grid-cols-2">
                <div className="sm:col-span-2">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Forecast reliability
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {reliability.reliabilityLabel}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Historical overrun frequency</div>
                  <div className="font-medium">
                    {reliability.overrunFrequency != null
                      ? `${Math.round(reliability.overrunFrequency)}%`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Average variance</div>
                  <div className="font-medium">
                    {reliability.averageVariancePercent != null
                      ? `${reliability.averageVariancePercent > 0 ? "+" : ""}${Math.round(reliability.averageVariancePercent)}%`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Sample size</div>
                  <div className="font-medium">{reliability.sampleSize ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Confidence</div>
                  <div className="font-medium">{reliability.confidenceLevel ?? "—"}</div>
                </div>
              </div>
            ) : null}

            {predicted?.rangeLabel ? (
              <div className="grid gap-3 rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:grid-cols-2">
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Predicted outcome
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{predicted.rangeLabel}</div>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Most likely
                  </div>
                  <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">
                    {predicted.predictedMostLikelyDuration != null
                      ? `${Math.round(predicted.predictedMostLikelyDuration)} Days`
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Confidence</div>
                  <div className="font-medium">{predicted.predictionConfidenceLevel ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">Evidence</div>
                  <div className="font-medium">
                    {predicted.evidenceCount ?? 0} Comparable Deliverable
                    {(predicted.evidenceCount ?? 0) === 1 ? "" : "s"}
                  </div>
                </div>
                {(predicted.reasoning ?? []).length > 0 ? (
                  <div className="sm:col-span-2">
                    <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Reasoning</div>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-600 dark:text-slate-300">
                      {predicted.reasoning.map((line: string, i: number) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="sm:col-span-2 text-xs text-slate-500 dark:text-slate-400">
                    Based on historical outcomes from comparable projects.
                  </div>
                )}
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
                  {(evidence?.matchedDeliverables ?? []).slice(0, 20).map((m, idx) => (
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
            <DeliverableRecommendationsSection recommendations={recommendations} />
          </>
        )}
      </CardContent>
    </Card>
  );
}
