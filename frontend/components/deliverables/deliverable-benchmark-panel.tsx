"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, History, Loader2, Scale } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  intelligenceApi,
  getApiErrorMessage,
  type BenchmarkOutlierStatus,
  type DeliverableAnalysisCore,
  type DeliverableIntelligenceAnalysis,
  type DeliverableProjectEvolutionReport,
  type IntelligenceFinding,
  type IntelligenceDriver,
  type IntelligenceRecommendation,
  type IntelligenceTrustExplanation,
} from "@/lib/api";
import {
  humanOutlierStatus,
  humanSnapshotRole,
} from "@/lib/intelligence-terminology";
import { evidenceBasisPhrase } from "@/lib/intelligence-language";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
import { DeliverableFindingsSection } from "@/components/deliverables/deliverable-findings-section";
import { DeliverableDriversSection } from "@/components/deliverables/deliverable-drivers-section";
import { DeliverableRecommendationsSection } from "@/components/deliverables/deliverable-recommendations-section";
import { DeliverableTrustSection } from "@/components/deliverables/deliverable-trust-section";
import { OpenInPlanningWorkspaceButton } from "@/components/intelligence/open-in-planning-workspace-button";

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

function plannerStatusLabel(status: Status, sampleSize: number): string {
  if (sampleSize === 0) return "No completed projects for comparison yet";
  if (status === "NORMAL") return "Looks normal";
  if (status === "SLIGHTLY_HIGH" || status === "SLIGHTLY_LOW") return "Worth a review";
  if (status === "WELL_BELOW") return "Significantly shorter than usual";
  if (status === "HIGH") return "Longer than usual";
  return "Needs attention";
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

function revisionRoleLabel(role: string | null, programmeState: string | null): string {
  const fromRole = humanSnapshotRole(role);
  if (fromRole !== "Programme update") return fromRole;
  if (programmeState) {
    return programmeState.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  return fromRole;
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
  const [data, setData] = useState<DeliverableAnalysisCore | null>(null);
  const [fullAnalysis, setFullAnalysis] = useState<DeliverableIntelligenceAnalysis | null>(null);
  const [findings, setFindings] = useState<IntelligenceFinding[]>([]);
  const [drivers, setDrivers] = useState<IntelligenceDriver[]>([]);
  const [recommendations, setRecommendations] = useState<IntelligenceRecommendation[]>([]);
  const [trust, setTrust] = useState<IntelligenceTrustExplanation | null>(null);
  const [tab, setTab] = useState<"previous_projects" | "project_evolution">("previous_projects");
  const [evolutionLoading, setEvolutionLoading] = useState(false);
  const [evolutionErr, setEvolutionErr] = useState<string | null>(null);
  const [evolution, setEvolution] = useState<DeliverableProjectEvolutionReport | null>(null);

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
          setFullAnalysis(analysis);
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

  useEffect(() => {
    if (!enabled || !projectId || !deliverableId) {
      return;
    }
    let cancelled = false;
    (async () => {
      setEvolutionLoading(true);
      setEvolutionErr(null);
      try {
        const { data } = await intelligenceApi.getDeliverableProjectEvolution(projectId, deliverableId);
        if (!cancelled) setEvolution(data);
      } catch (e: unknown) {
        if (!cancelled) {
          setEvolution(null);
          setEvolutionErr(getApiErrorMessage(e) || "Failed to load project evolution");
        }
      } finally {
        if (!cancelled) setEvolutionLoading(false);
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
  const current =
    data?.durationView?.current.durationDays ?? outlier?.currentDurationDays ?? null;
  const baselineDuration = data?.durationView?.baseline.durationDays ?? null;
  const baselineLabel = data?.durationView?.baseline.snapshotLabel ?? "Baseline";
  const sampleSize = benchmark?.sampleSize ?? 0;
  const notes: string[] = benchmark?.notes ?? [];

  const statusLabel = plannerStatusLabel(status, sampleSize || (expected?.evidenceCount ?? 0));
  const typical = expected?.rangeLabel ?? (expected?.mostLikelyDays != null ? `${expected.mostLikelyDays} days` : "—");
  const comparedWithPreviousProjects =
    sampleSize === 0 && (expected?.evidenceCount ?? 0) === 0
      ? "No completed projects available for comparison yet"
      : outlier?.effectivePositionLabel ?? humanOutlierStatus(status);

  const matched = evidence?.matchedDeliverables ?? [];
  const fromThisProject = matched.filter((m) => m.projectId === projectId);
  const fromOtherProjects = matched.filter((m) => m.projectId !== projectId);
  const distinctOtherProjects = useMemo(() => new Set(fromOtherProjects.map((m) => m.projectId)).size, [fromOtherProjects]);

  if (loading) {
    return (
      <Card className="border-slate-200 dark:border-slate-700">
        <CardContent className="flex items-center gap-2 py-8 text-sm text-slate-600 dark:text-slate-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          Comparing with previous projects…
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
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Two different questions: how this compares with <strong>other completed projects</strong>, and how it has{" "}
        <strong>changed on this project</strong> over time.
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
            tab === "previous_projects"
              ? "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-800/60"
          }`}
          onClick={() => setTab("previous_projects")}
        >
          <Scale className="h-4 w-4" />
          Compared with Previous Projects
        </button>
        <button
          type="button"
          className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm ${
            tab === "project_evolution"
              ? "border-violet-300 bg-violet-50 text-violet-900 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200"
              : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900/50 dark:text-slate-200 dark:hover:bg-slate-800/60"
          }`}
          onClick={() => setTab("project_evolution")}
        >
          <History className="h-4 w-4" />
          Project Evolution
        </button>
      </div>

      {tab === "previous_projects" ? (
        <>
          <Card className="border-violet-200/80 bg-violet-50/30 dark:border-violet-900/40 dark:bg-violet-950/20">
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CardTitle className="text-lg">Rana’s view</CardTitle>
                <Badge variant={statusVariant(status)}>{statusLabel}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{comparedWithPreviousProjects}</p>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <MetricTile label="Typical duration" value={typical} />
              <MetricTile
                label="Current programme"
                value={current != null ? `${current} days` : "—"}
                sub="Latest imported programme"
              />
              <MetricTile
                label="Baseline"
                value={baselineDuration != null ? `${baselineDuration} days` : "—"}
                sub={baselineLabel}
              />
              <MetricTile
                label="Based on"
                value={
                  sampleSize > 0
                    ? evidenceBasisPhrase(sampleSize, distinctOtherProjects)
                    : "No completed projects yet"
                }
              />
            </CardContent>
          </Card>

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
          title="Supporting work packages"
          description="Similar work from completed projects. This project’s own revision history is under Project Evolution."
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
            <div className="space-y-4">
              {fromOtherProjects.length > 0 ? (
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    Previous projects
                  </div>
                  <ul className="space-y-2 text-sm">
                    {fromOtherProjects.slice(0, 20).map((m, idx) => (
                      <li key={idx} className="rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
                        <div className="font-medium">
                          {m.projectName} — {m.deliverableName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{m.durationDays} days</div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {fromThisProject.length > 0 ? (
                <div>
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                    This project’s own history
                  </div>
                  <ul className="space-y-2 text-sm">
                    {fromThisProject.slice(0, 20).map((m, idx) => (
                      <li key={idx} className="rounded-md border border-slate-100 px-3 py-2 dark:border-slate-800">
                        <div className="font-medium">{m.deliverableName}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{m.durationDays} days</div>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    These belong in Project Evolution. They’re shown here only so the two sources don’t get mixed up.
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
        </IntelligenceSection>
      ) : null}

      {notes.length > 0 ? (
        <IntelligenceSection
          title="More detail (for audit)"
          description="Extra notes recorded during the comparison."
          collapsible
          defaultOpen={false}
        >
          <div className="space-y-1 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900/20 dark:text-slate-300">
            {notes.map((n, i) => (
              <div key={i}>{n}</div>
            ))}
          </div>
        </IntelligenceSection>
      ) : null}

      {/* Trust */}
      <IntelligenceSection
        title="How reliable is this?"
        description="How much completed project history this is based on."
        helpTopic="evidenceQuality"
      >
        <DeliverableTrustSection trust={trust} />
      </IntelligenceSection>

      <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-700 dark:bg-slate-900/40">
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-300">
          Ready to change the programme? Open the planning workspace to edit this deliverable in context.
        </p>
        <OpenInPlanningWorkspaceButton />
      </div>
        </>
      ) : (
        <Card className="border-slate-200 dark:border-slate-700">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Project Evolution</CardTitle>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
              How this deliverable has changed on this project over time (baseline → programme updates → as-built).
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {evolutionLoading ? (
              <p className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading revision history…
              </p>
            ) : evolutionErr ? (
              <p className="text-sm text-red-600 dark:text-red-400">{evolutionErr}</p>
            ) : !evolution || evolution.revisions.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No revision history for this deliverable yet. Import a baseline or programme update to start tracking
                how it changes over time.
              </p>
            ) : (
              <>
                {evolution.timeline.evolutionSummary ? (
                  <p className="text-sm text-slate-700 dark:text-slate-200">{evolution.timeline.evolutionSummary}</p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-3">
                  <MetricTile
                    label="Baseline duration"
                    value={
                      evolution.evolution.initialDuration != null
                        ? `${evolution.evolution.initialDuration} days`
                        : "—"
                    }
                  />
                  <MetricTile
                    label="Peak duration"
                    value={
                      evolution.evolution.maximumDuration != null
                        ? `${evolution.evolution.maximumDuration} days`
                        : "—"
                    }
                    sub={
                      evolution.evolution.growthPercent != null
                        ? `+${evolution.evolution.growthPercent}% from baseline`
                        : undefined
                    }
                  />
                  <MetricTile
                    label="Latest duration"
                    value={
                      evolution.evolution.finalDuration != null
                        ? `${evolution.evolution.finalDuration} days`
                        : "—"
                    }
                    sub={
                      evolution.evolution.reductionPercent != null &&
                      evolution.evolution.reductionPercent > 0
                        ? `−${evolution.evolution.reductionPercent}% from peak`
                        : undefined
                    }
                  />
                </div>

                {evolution.evolution.largestChangeDays != null && evolution.evolution.largestChangeDays > 0 ? (
                  <p className="text-sm text-slate-600 dark:text-slate-300">
                    Largest single revision change: {evolution.evolution.largestChangeDays} day
                    {evolution.evolution.largestChangeDays === 1 ? "" : "s"}.
                  </p>
                ) : null}

                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Revision timeline</h4>
                  <ul className="mt-2 space-y-2">
                    {evolution.revisions.map((rev, index) => (
                      <li
                        key={rev.snapshotId}
                        className="flex flex-wrap items-baseline justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-sm dark:border-slate-700"
                      >
                        <div>
                          <span className="font-medium text-slate-900 dark:text-white">
                            {rev.label || `Update ${index + 1}`}
                          </span>
                          <span className="ml-2 text-xs text-slate-500">
                            {revisionRoleLabel(rev.role, rev.programmeState)}
                          </span>
                        </div>
                        <div className="text-right text-xs text-slate-600 dark:text-slate-300">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                            {rev.durationDays != null ? `${rev.durationDays} days` : "—"}
                            {rev.durationChangeDays != null && rev.durationChangeDays !== 0 ? (
                              <span className="ml-2 font-normal text-slate-500">
                                ({rev.durationChangeDays > 0 ? "+" : ""}
                                {rev.durationChangeDays} days)
                              </span>
                            ) : null}
                          </div>
                          <div className="text-slate-400">
                            Imported {new Date(rev.importedAt).toLocaleDateString()}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>

                {evolution.programmeLogicEvolution?.some((r) => r.hasMeaningfulChanges) ? (
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Programme story
                    </h4>
                    <ol className="mt-3 space-y-4">
                      {evolution.programmeLogicEvolution
                        .filter((r) => r.hasMeaningfulChanges)
                        .map((rev, index, arr) => (
                          <li key={rev.snapshotId} className="relative pl-4">
                            {index < arr.length - 1 ? (
                              <span
                                className="absolute left-1 top-5 bottom-0 w-px bg-slate-200 dark:bg-slate-700"
                                aria-hidden
                              />
                            ) : null}
                            <span
                              className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-violet-500"
                              aria-hidden
                            />
                            <div className="font-medium text-slate-900 dark:text-white">{rev.revisionLabel}</div>
                            {rev.storyBullets.length > 0 ? (
                              <ul className="mt-1.5 list-disc space-y-1 pl-4 text-sm text-slate-600 dark:text-slate-300">
                                {rev.storyBullets.map((bullet) => (
                                  <li key={bullet}>{bullet}</li>
                                ))}
                              </ul>
                            ) : null}
                            {rev.plannerObservations.length > 0 ? (
                              <ul className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
                                {rev.plannerObservations.slice(0, 4).map((obs) => (
                                  <li key={obs} className="leading-snug">
                                    {obs}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </li>
                        ))}
                    </ol>
                  </div>
                ) : null}
              </>
            )}
          </CardContent>
        </Card>
      )}

    </div>
  );
}
