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
import {
  buildDeliverableSummary,
  humanConfidenceLevel,
  humanDurationPosition,
  humanOutlierStatus,
  INTELLIGENCE_LABELS,
} from "@/lib/intelligence-terminology";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
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
  if (s === "RED_FLAG" || s === "EXTREME_OUTLIER" || s === "WELL_BELOW") return "destructive";
  if (s === "HIGH" || s === "SLIGHTLY_LOW") return "default";
  if (s === "SLIGHTLY_HIGH") return "secondary";
  return "outline";
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900 dark:text-white">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{sub}</div> : null}
    </div>
  );
}

export function DeliverableBenchmarkPanel({
  projectId,
  deliverableId,
  enabled = true,
  refreshKey = 0,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
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
        if (!cancelled) setErr(getApiErrorMessage(e) || "Failed to load analysis");
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
  const positionLabel =
    outlier?.effectivePositionLabel ??
    humanDurationPosition(outlier?.effectivePosition ?? outlier?.position ?? null) ??
    humanOutlierStatus(status);
  const positionCapped =
    (outlier?.rawPosition != null &&
      outlier?.effectivePosition != null &&
      outlier.rawPosition !== outlier.effectivePosition) ||
    (outlier?.rawStatus != null && outlier.rawStatus !== status);
  const current = outlier?.currentDurationDays ?? null;
  const avg = benchmark?.averageDuration ?? null;
  const med = benchmark?.medianDuration ?? null;
  const p25 = benchmark?.percentile25 ?? null;
  const p75 = benchmark?.percentile75 ?? null;
  const min = benchmark?.minimumDuration ?? null;
  const max = benchmark?.maximumDuration ?? null;
  const sampleSize = benchmark?.sampleSize ?? 0;
  const diffAvg = outlier?.differenceFromAveragePercent ?? null;
  const confidenceLevel = benchmark?.confidenceLevel ?? null;
  const notes: string[] = benchmark?.notes ?? [];

  const confidenceLabel = humanConfidenceLevel(expected?.confidenceLevel ?? confidenceLevel);
  const statusLabel = positionLabel;

  const historicalAlignment = useMemo(() => {
    if (sampleSize === 0 && (expected?.evidenceCount ?? 0) === 0) return "No historical comparison yet";
    return positionLabel;
  }, [sampleSize, expected?.evidenceCount, positionLabel]);

  const summaryText = useMemo(
    () =>
      buildDeliverableSummary({
        outlierLabel: statusLabel,
        confidenceLabel,
        sampleSize: sampleSize || (expected?.evidenceCount ?? 0),
        observationCount: findings.length,
        recommendationCount: recommendations.length,
        trustLabel: trust?.trustLabel ?? null,
        positionCapped,
        evidenceLimited: confidenceLabel === "Limited" || sampleSize <= 2,
      }),
    [statusLabel, confidenceLabel, sampleSize, expected?.evidenceCount, findings.length, recommendations.length, trust?.trustLabel, positionCapped]
  );

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading deliverable analysis…
        </CardContent>
      </Card>
    );
  }

  if (err) {
    return (
      <Card className="border-red-200 dark:border-red-900/50">
        <CardContent className="py-6 text-sm text-red-600 dark:text-red-400">{err}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* 1. Overall Assessment */}
      <Card className="border-violet-200/80 bg-violet-50/30 dark:border-violet-900/40 dark:bg-violet-950/20">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CardTitle className="text-lg">Overall assessment</CardTitle>
            <Badge variant={statusVariant(status)}>{statusLabel}</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <MetricTile label="Status" value={statusLabel} />
          <MetricTile label={INTELLIGENCE_LABELS.confidence} value={confidenceLabel} />
          <MetricTile label="Historical alignment" value={historicalAlignment} />
        </CardContent>
      </Card>

      {/* 2. Key metrics row */}
      <div className="grid gap-3 lg:grid-cols-3">
        {expected?.rangeLabel ? (
          <MetricTile
            label="Expected duration"
            value={expected.rangeLabel}
            sub={expected.mostLikelyDays != null ? `Most likely: ${expected.mostLikelyDays} days` : undefined}
          />
        ) : null}
        {predicted?.rangeLabel ? (
          <MetricTile
            label={INTELLIGENCE_LABELS.prediction}
            value={predicted.rangeLabel}
            sub={
              predicted.predictedMostLikelyDuration != null
                ? `Most likely: ${Math.round(predicted.predictedMostLikelyDuration)} days`
                : undefined
            }
          />
        ) : null}
        {reliability?.reliabilityLabel ? (
          <MetricTile
            label={INTELLIGENCE_LABELS.forecastReliability}
            value={reliability.reliabilityLabel}
            sub={
              reliability.overrunFrequency != null
                ? `${Math.round(reliability.overrunFrequency)}% historically overran`
                : undefined
            }
          />
        ) : null}
      </div>

      {(expected?.confidenceLevel === "LOW" || confidenceLevel === "LOW") &&
      sampleSize + (expected?.evidenceCount ?? 0) > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
          Limited historical evidence. Treat these figures as guidance and review supporting evidence below.
        </div>
      ) : null}

      {/* 3. Summary */}
      <IntelligenceSection title="Summary" description="What Rana4 found at a glance.">
        <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">{summaryText}</p>
      </IntelligenceSection>

      {/* 4. Why? / Observations */}
      <IntelligenceSection
        title="Why?"
        description="Observations that explain how this deliverable compares to previous projects."
        helpTopic="observations"
      >
        <DeliverableFindingsSection findings={findings} />
      </IntelligenceSection>

      {/* 5. Key Factors */}
      <IntelligenceSection
        title="Key factors"
        description="Patterns from comparable projects that may influence duration."
        helpTopic="keyFactors"
      >
        <DeliverableDriversSection drivers={drivers} />
      </IntelligenceSection>

      {/* 6. Recommendations */}
      <IntelligenceSection
        title="Recommendations"
        description="Evidence-based items you may wish to review. Rana4 does not change your schedule."
        helpTopic="recommendations"
      >
        <DeliverableRecommendationsSection recommendations={recommendations} />
      </IntelligenceSection>

      {/* 7. Supporting Evidence */}
      {sampleSize > 0 ? (
        <IntelligenceSection
          title={INTELLIGENCE_LABELS.evidence}
          description="Similar deliverables from imported project history."
          collapsible
          defaultOpen={false}
        >
          <button
            type="button"
            className="mb-3 flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/30"
            onClick={() => setEvidenceOpen((v) => !v)}
          >
            <span>
              {sampleSize} comparable deliverable{sampleSize === 1 ? "" : "s"} matched
            </span>
            {evidenceOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          {evidenceOpen ? (
            <ul className="space-y-2 text-sm">
              {(evidence?.matchedDeliverables ?? []).slice(0, 20).map((m, idx) => (
                <li key={idx} className="rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
                  <div className="font-medium">
                    {m.projectName} — {m.deliverableName}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    {m.durationDays} days · {Number(m.similarityScore).toFixed(1)}% similarity
                  </div>
                </li>
              ))}
            </ul>
          ) : null}
        </IntelligenceSection>
      ) : null}

      {/* 8. Detailed Historical Comparison (collapsible) */}
      <IntelligenceSection
        title={`Detailed ${INTELLIGENCE_LABELS.benchmark.toLowerCase()}`}
        description="Raw statistics from historical deliverables. Expand when you need the detail."
        helpTopic="historicalComparison"
        collapsible
        defaultOpen={false}
      >
        <button
          type="button"
          className="mb-3 flex w-full items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-left text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-900/30"
          onClick={() => setBenchmarkOpen((v) => !v)}
        >
          <span>View statistics</span>
          {benchmarkOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {benchmarkOpen ? (
          <div className="space-y-3">
            {notes.length > 0 ? (
              <div className="space-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/20 dark:text-slate-300">
                {notes.map((n, i) => (
                  <div key={i}>{n}</div>
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <MetricTile label="Current duration" value={current != null ? `${current} days` : "—"} />
              <MetricTile label="Difference vs average" value={diffAvg != null ? `${diffAvg > 0 ? "+" : ""}${diffAvg}%` : "—"} />
              <MetricTile label="Historical minimum" value={min != null ? `${min} days` : "—"} />
              <MetricTile label="Historical maximum" value={max != null ? `${max} days` : "—"} />
              <MetricTile label="Historical average" value={avg != null ? `${avg} days` : "—"} />
              <MetricTile label="Historical median" value={med != null ? `${med} days` : "—"} />
            </div>
          </div>
        ) : null}
      </IntelligenceSection>

      {/* 9. Trust & Explainability */}
      <IntelligenceSection
        title="Evidence quality"
        description="How much you can rely on this analysis, based on evidence volume and coverage."
        helpTopic="evidenceQuality"
      >
        <DeliverableTrustSection trust={trust} />
      </IntelligenceSection>

      {/* 10. Ask Rana4 */}
      <IntelligenceSection
        title="Ask Rana4"
        description="Get a plain-language explanation grounded in the analysis above."
      >
        <DeliverableExplanationPanel
          projectId={projectId}
          deliverableId={deliverableId}
          enabled={enabled && !loading && !err}
        />
      </IntelligenceSection>
    </div>
  );
}
