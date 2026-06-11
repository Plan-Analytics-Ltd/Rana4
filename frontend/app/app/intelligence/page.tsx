"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Brain, Loader2, RefreshCw, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  organisationalIntelligenceApi,
  getApiErrorMessage,
  type DeliverableKnowledgeProfile,
  type DeliverableOutcomeProfile,
  type DeliverableReliabilityProfile,
  type LearnedInsight,
  type LearnedInsightType,
  type RecommendationTrendGroup,
  type IntelligenceTrustProfile,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const SECTIONS: {
  type: LearnedInsightType;
  title: string;
  description: string;
}[] = [
  {
    type: "DURATION_OVERRUN",
    title: "Often took longer than planned",
    description: "Deliverable types that frequently ran over their planned duration.",
  },
  {
    type: "DURATION_PREDICTABILITY",
    title: "Usually predictable",
    description: "Deliverable types with consistent durations across previous projects.",
  },
  {
    type: "FLOAT_CONSUMPTION",
    title: "Used up schedule buffer",
    description: "Stages where deliverables consumed more float than usual.",
  },
  {
    type: "DRIVER_STRENGTH",
    title: "What affects duration most",
    description: "Project characteristics linked to longer or shorter deliverable durations.",
  },
  {
    type: "RECURRING_LESSON",
    title: "Seen again and again",
    description: "Patterns that showed up across multiple previous projects.",
  },
  {
    type: "FORECAST_RELIABILITY",
    title: "Forecast reliability",
    description: "How often original duration estimates matched what actually happened.",
  },
  {
    type: "OUTCOME_PREDICTION",
    title: "Outcome predictions",
    description: "What is most likely to happen, based on expected duration and historical overrun behaviour.",
  },
];

function confidenceBadge(level: LearnedInsight["confidenceLevel"]): string {
  if (level === "HIGH") return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200";
  if (level === "MEDIUM") return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200";
  return "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
}

function maturityBadge(maturity: string): string {
  if (maturity === "WELL_KNOWN") return "text-emerald-700 dark:text-emerald-300";
  if (maturity === "MODERATE") return "text-amber-700 dark:text-amber-300";
  return "text-slate-500 dark:text-slate-400";
}

function InsightCard({ insight }: { insight: LearnedInsight }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{insight.title}</h3>
        <span
          className={cn(
            "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            confidenceBadge(insight.confidenceLevel)
          )}
        >
          {insight.confidenceLevel} · {Math.round(insight.confidenceScore * 100)}%
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{insight.summary}</p>
      <p className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800/60 dark:text-slate-100">
        {insight.observation}
      </p>
      <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500 dark:text-slate-400">
        <span>Based on {insight.sampleSize} examples</span>
        <span>Updated {new Date(insight.lastCalculatedAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function formatVariancePercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value)}%`;
}

function ReliabilityProfileCard({ profile }: { profile: DeliverableReliabilityProfile }) {
  const overrunSummary =
    profile.overrunFrequency >= 50
      ? `${Math.round(profile.overrunFrequency)}% exceeded original estimates`
      : profile.onTargetFrequency >= 45
        ? `${Math.round(profile.onTargetFrequency)}% finished within tolerance`
        : `${Math.round(profile.underrunFrequency)}% finished earlier than planned`;

  return (
    <div className="rounded-lg border border-violet-200 bg-white p-4 dark:border-violet-900/40 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900 dark:text-white">{profile.label}</h3>
        <span className="rounded bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
          {profile.reliabilityLabel}
        </span>
      </div>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{overrunSummary}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">Average variance</div>
          <div className="font-semibold">{formatVariancePercent(profile.averageVariancePercent)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Confidence</div>
          <div className="font-semibold">{profile.confidenceLevel}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Sample size</div>
          <div className="font-semibold">
            {profile.sampleSize} examples · {profile.projectCount} projects
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">On target</div>
          <div className="font-semibold">{Math.round(profile.onTargetFrequency)}%</div>
        </div>
      </div>
    </div>
  );
}

function TrustProfileCard({ profile }: { profile: IntelligenceTrustProfile }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900 dark:text-white">{profile.label}</h3>
        <span className="flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">
          <Shield className="h-3 w-3" />
          {profile.trustLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">Evidence strength</div>
          <div className="font-semibold">{profile.evidenceStrength.strengthLabel}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Coverage</div>
          <div className="font-semibold">{profile.knowledgeCoverage.coverageLabel}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Evidence</div>
          <div className="font-semibold">
            {profile.evidenceStrength.sampleSize} examples · {profile.evidenceStrength.projectCount} projects
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Active layers</div>
          <div className="font-semibold">{profile.evidenceStrength.layersAvailable.length}</div>
        </div>
      </div>
      {profile.whySeeingThis[0] ? (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{profile.whySeeingThis[0]}</p>
      ) : null}
    </div>
  );
}

function RecommendationTrendCard({ group }: { group: RecommendationTrendGroup }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <h3 className="font-medium text-slate-900 dark:text-white">{group.typeLabel}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{group.description}</p>
      <ul className="mt-3 space-y-2">
        {group.profiles.slice(0, 6).map((p) => (
          <li key={p.id} className="rounded-md bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/50">
            <div className="font-medium text-slate-900 dark:text-white">{p.label}</div>
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{p.recommendation}</div>
            <div className="mt-1 text-xs text-slate-500">
              {p.evidenceCount} examples · confidence {p.confidenceLevel}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutcomeProfileCard({ profile }: { profile: DeliverableOutcomeProfile }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-white p-4 dark:border-emerald-900/40 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900 dark:text-white">{profile.label}</h3>
        <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
          {profile.predictionConfidenceLevel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">Predicted range</div>
          <div className="font-semibold">{profile.rangeLabel ?? "—"}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Most likely</div>
          <div className="font-semibold">
            {profile.predictedMostLikelyDuration != null
              ? `${Math.round(profile.predictedMostLikelyDuration)} days`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Evidence</div>
          <div className="font-semibold">
            {profile.sampleSize} examples · {profile.projectCount} projects
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Historical overrun</div>
          <div className="font-semibold">{Math.round(profile.historicalOverrunFrequency)}%</div>
        </div>
      </div>
    </div>
  );
}

function ProfileCard({ profile }: { profile: DeliverableKnowledgeProfile }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-medium text-slate-900 dark:text-white">{profile.label}</h3>
        <span className={cn("text-xs font-medium", maturityBadge(profile.learningMaturity))}>
          {profile.maturityLabel}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-xs text-slate-500">Typical duration</div>
          <div className="font-semibold">
            {profile.medianDuration != null ? `${profile.medianDuration} days` : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Range seen</div>
          <div className="font-semibold">
            {profile.minimumDuration != null && profile.maximumDuration != null
              ? `${profile.minimumDuration}–${profile.maximumDuration} days`
              : "—"}
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Evidence</div>
          <div className="font-semibold">
            {profile.sampleSize} examples · {profile.projectCount} projects
          </div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Confidence</div>
          <div className="font-semibold">{profile.confidenceLevel}</div>
        </div>
      </div>
    </div>
  );
}

export default function IntelligencePage() {
  const [insights, setInsights] = useState<LearnedInsight[]>([]);
  const [profiles, setProfiles] = useState<DeliverableKnowledgeProfile[]>([]);
  const [reliabilityProfiles, setReliabilityProfiles] = useState<DeliverableReliabilityProfile[]>([]);
  const [outcomeProfiles, setOutcomeProfiles] = useState<DeliverableOutcomeProfile[]>([]);
  const [recommendationTrends, setRecommendationTrends] = useState<RecommendationTrendGroup[]>([]);
  const [trustProfiles, setTrustProfiles] = useState<IntelligenceTrustProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const loadData = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const { data } = await organisationalIntelligenceApi.dashboard(refresh ? { refresh: true } : undefined);
      setInsights(data.insights ?? []);
      setProfiles(data.deliverableProfiles ?? []);
      setReliabilityProfiles(data.reliabilityProfiles ?? []);
      setOutcomeProfiles(data.outcomeProfiles ?? []);
      setRecommendationTrends(data.recommendationTrends ?? []);
      setTrustProfiles(data.trustProfiles ?? []);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load insights");
      setInsights([]);
      setProfiles([]);
      setReliabilityProfiles([]);
      setOutcomeProfiles([]);
      setRecommendationTrends([]);
      setTrustProfiles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const byType = useMemo(() => {
    const map = new Map<LearnedInsightType, LearnedInsight[]>();
    for (const s of SECTIONS) map.set(s.type, []);
    for (const i of insights) {
      const list = map.get(i.insightType) ?? [];
      list.push(i);
      map.set(i.insightType, list);
    }
    return map;
  }, [insights]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      const { data: regen } = await organisationalIntelligenceApi.regenerate();
      setInsights(regen.insights ?? []);
      const { data: dash } = await organisationalIntelligenceApi.dashboard();
      setProfiles(dash.deliverableProfiles ?? []);
      setReliabilityProfiles(dash.reliabilityProfiles ?? []);
      setOutcomeProfiles(dash.outcomeProfiles ?? []);
      setRecommendationTrends(dash.recommendationTrends ?? []);
      setTrustProfiles(dash.trustProfiles ?? []);
      toast.success(`Updated ${regen.count} insight(s) from project history`);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Update failed (admin role may be required)");
    } finally {
      setRegenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            <Brain className="h-7 w-7 text-violet-600 dark:text-violet-400" />
            What We&apos;ve Learned
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Insights built from previous projects. The more project history you import, the smarter the analysis
            becomes.
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleRegenerate()} disabled={loading || regenerating}>
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {regenerating ? "Updating…" : "Update Insights"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      ) : (
        <>
          {trustProfiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Shield className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                  Trust &amp; explainability
                </CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  How much you can rely on intelligence for each deliverable type — based on evidence, not AI.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2">
                  {trustProfiles.map((p) => (
                    <TrustProfileCard key={p.id} profile={p} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {reliabilityProfiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Forecast reliability</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  How often original duration estimates matched what actually happened on previous projects.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2">
                  {reliabilityProfiles.map((p) => (
                    <ReliabilityProfileCard key={p.id} profile={p} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {outcomeProfiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Outcome predictions</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  What is most likely to happen, combining expected duration with historical overrun behaviour.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2">
                  {outcomeProfiles.map((p) => (
                    <OutcomeProfileCard key={p.id} profile={p} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {recommendationTrends.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recommendation trends</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Deliverable types that most commonly surface each kind of evidence-based recommendation.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2">
                  {recommendationTrends.map((g) => (
                    <RecommendationTrendCard key={g.recommendationType} group={g} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {profiles.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Deliverable knowledge</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  How long each type of deliverable typically takes, based on imported project history.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 lg:grid-cols-2">
                  {profiles.map((p) => (
                    <ProfileCard key={p.id} profile={p} />
                  ))}
                </div>
              </CardContent>
            </Card>
          ) : null}

          {insights.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                <p>No insights yet.</p>
                <p className="mt-2">
                  Import project history from completed projects, then generate insights to build your learning
                  library.
                </p>
                <Button className="mt-4" variant="outline" onClick={() => void loadData(true)}>
                  Generate Insights
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-8">
              {SECTIONS.map((section) => {
                const items = byType.get(section.type) ?? [];
                return (
                  <Card key={section.type}>
                    <CardHeader>
                      <CardTitle className="text-lg">{section.title}</CardTitle>
                      <p className="text-sm text-slate-500 dark:text-slate-400">{section.description}</p>
                    </CardHeader>
                    <CardContent>
                      {items.length === 0 ? (
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                          Not enough evidence yet for this category (needs at least 10 comparable examples).
                        </p>
                      ) : (
                        <div className="grid gap-4 lg:grid-cols-2">
                          {items.map((insight) => (
                            <InsightCard key={insight.id} insight={insight} />
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
