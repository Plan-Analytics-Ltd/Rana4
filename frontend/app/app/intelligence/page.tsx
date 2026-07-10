"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Brain, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  organisationalIntelligenceApi,
  getApiErrorMessage,
  type DeliverableKnowledgeProfile,
  type DeliverableOutcomeProfile,
  type DeliverableReliabilityProfile,
  type IntelligenceDashboard,
  type LearnedInsight,
  type RecommendationTrendGroup,
  type IntelligenceTrustProfile,
  type OrganisationKnowledgeEntry,
} from "@/lib/api";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
import { IntelligenceEmptyState, IntelligenceEmptyStateButton } from "@/components/intelligence/intelligence-empty-state";
import { ProjectIntelligenceOverview } from "@/components/intelligence/dashboard/project-intelligence-overview";
import { DeliverableTypeDetailDialog } from "@/components/intelligence/dashboard/deliverable-type-detail-dialog";
import { useProject } from "@/contexts/project-context";
import { SimilarProjectsCard } from "@/components/intelligence/organisation/similar-projects-card";
import { LessonsFromPreviousProjects } from "@/components/intelligence/organisation/lessons-from-previous-projects";
import { OrganisationalPatternsSection } from "@/components/intelligence/organisation/organisational-patterns-section";
import {
  intelligenceApi,
  type LessonFinding,
  type OrganisationalPattern,
  type SimilarProjectMatch,
} from "@/lib/api";
import { computeOrgKpis } from "@/lib/intelligence-terminology";
import {
  adaptiveProjectsHeading,
  groupByUnderstanding,
  rankPredictability,
  reviewThemeLabel,
  TONE_CLASSES,
  typicalDurationPhrase,
  understandingFor,
  type PredictabilityRank,
} from "@/lib/intelligence-language";
import { cn } from "@/lib/utils";

const EMPTY_DASHBOARD: IntelligenceDashboard = {
  insights: [],
  deliverableProfiles: [],
  reliabilityProfiles: [],
  outcomeProfiles: [],
  recommendationProfiles: [],
  recommendationTrends: [],
  trustProfiles: [],
};

function ClickableTypeCard({
  title,
  detail,
  badge,
  badgeTone,
  onClick,
}: {
  title: string;
  detail: string;
  badge?: string;
  badgeTone?: "good" | "moderate" | "low";
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group flex w-full items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4 text-left transition dark:border-slate-700 dark:bg-slate-900/50",
        onClick ? "hover:border-violet-300 hover:shadow-sm dark:hover:border-violet-800" : "cursor-default"
      )}
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {badge ? (
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              TONE_CLASSES[badgeTone ?? "moderate"]
            )}
          >
            {badge}
          </span>
        ) : null}
        {onClick ? (
          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-violet-500 dark:text-slate-600" />
        ) : null}
      </div>
    </button>
  );
}

function PredictabilityColumn({ heading, hint, items }: { heading: string; hint: string; items: PredictabilityRank[] }) {
  return (
    <div>
      <h3 className="text-base font-semibold text-slate-900 dark:text-white">{heading}</h3>
      <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item.classification}
            className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900/50"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-slate-900 dark:text-white">{item.label}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400">{item.typical}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">{item.story}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function IntelligencePage() {
  const { selectedProjectId } = useProject();
  const [data, setData] = useState<IntelligenceDashboard>(EMPTY_DASHBOARD);
  const [similarProjects, setSimilarProjects] = useState<SimilarProjectMatch[]>([]);
  const [findings, setFindings] = useState<LessonFinding[]>([]);
  const [patterns, setPatterns] = useState<OrganisationalPattern[]>([]);
  const [orgEntries, setOrgEntries] = useState<OrganisationKnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [detailClassification, setDetailClassification] = useState<string | null>(null);

  const loadData = useCallback(async (refresh = false) => {
    setLoading(true);
    try {
      const dashPromise = organisationalIntelligenceApi.dashboard(refresh ? { refresh: true } : undefined);
      const orgKnowledgePromise = organisationalIntelligenceApi.organisationKnowledge();
      const lessonsPromise = organisationalIntelligenceApi.lessonsLearned();
      const similarPromise = selectedProjectId
        ? intelligenceApi.similarProjects(selectedProjectId, { limit: 5 })
        : Promise.resolve({ data: { matches: [] as SimilarProjectMatch[], confidence: 0, explanations: [] } });

      const [dash, orgKnowledge, lessons, similar] = await Promise.all([
        dashPromise,
        orgKnowledgePromise,
        lessonsPromise,
        similarPromise,
      ]);

      setData({ ...EMPTY_DASHBOARD, ...dash.data });
      setOrgEntries(orgKnowledge.data.entries ?? []);
      setPatterns(orgKnowledge.data.patterns ?? []);
      setFindings(lessons.data.findings ?? []);
      setSimilarProjects(similar.data.matches ?? []);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load insights");
      setData(EMPTY_DASHBOARD);
      setOrgEntries([]);
      setPatterns([]);
      setFindings([]);
      setSimilarProjects([]);
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const kpis = useMemo(() => computeOrgKpis(data), [data]);

  const insights = data.insights;
  const profiles = data.deliverableProfiles;
  const reliabilityProfiles = data.reliabilityProfiles;
  const outcomeProfiles = data.outcomeProfiles;
  const recommendationTrends = data.recommendationTrends;
  const trustProfiles = data.trustProfiles;

  const hasAnyData =
    insights.length > 0 ||
    profiles.length > 0 ||
    reliabilityProfiles.length > 0 ||
    outcomeProfiles.length > 0 ||
    recommendationTrends.length > 0 ||
    trustProfiles.length > 0 ||
    patterns.length > 0 ||
    findings.length > 0;

  const predictability = useMemo(
    () => rankPredictability(reliabilityProfiles, outcomeProfiles),
    [reliabilityProfiles, outcomeProfiles]
  );

  const reviewThemes = useMemo(() => {
    return recommendationTrends
      .map((g) => ({
        label: reviewThemeLabel(g.recommendationType, g.typeLabel),
        count: g.profiles.length,
        examples: g.profiles.slice(0, 3).map((p) => p.label),
      }))
      .filter((t) => t.count > 0)
      .sort((a, b) => b.count - a.count);
  }, [recommendationTrends]);

  const understanding = useMemo(() => groupByUnderstanding(profiles), [profiles]);

  const openType = (classification: string | null) => {
    if (classification) setDetailClassification(classification);
  };

  const handleRegenerate = async () => {
    setRegenerating(true);
    try {
      await organisationalIntelligenceApi.regenerate();
      const { data: dash } = await organisationalIntelligenceApi.dashboard();
      setData({ ...EMPTY_DASHBOARD, ...dash });
      toast.success("Rana has refreshed what it has learned using the latest project information.");
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
            {adaptiveProjectsHeading(kpis.projectsAnalysed)}
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
            Organisational memory from completed projects — separate from how your current programme has changed over time.
          </p>
        </div>
        <Button variant="outline" onClick={() => void handleRegenerate()} disabled={loading || regenerating}>
          {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {regenerating ? "Updating…" : "Update"}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Bringing together what Rana has learned…
        </div>
      ) : (
        <>
          {hasAnyData ? (
            <IntelligenceSection
              title="Organisational memory"
              description="Everything Rana has learned from completed programmes you have imported."
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-3xl font-semibold text-violet-700 dark:text-violet-300">
                    {kpis.projectsAnalysed}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">completed projects</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-3xl font-semibold text-violet-700 dark:text-violet-300">
                    {kpis.historicalDeliverables}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">work packages learned from</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
                  <div className="text-3xl font-semibold text-violet-700 dark:text-violet-300">
                    {kpis.profilesCount}
                  </div>
                  <div className="mt-1 text-sm text-slate-600 dark:text-slate-300">types of work understood</div>
                </div>
              </div>
            </IntelligenceSection>
          ) : null}

          {selectedProjectId ? (
            <SimilarProjectsCard
              matches={similarProjects}
              loading={loading}
              comparisonHref="/app/intelligence/comparison"
            />
          ) : null}

          <LessonsFromPreviousProjects
            insights={insights}
            findings={findings}
            patterns={patterns}
            loading={loading}
            limit={8}
          />

          <OrganisationalPatternsSection
            patterns={patterns}
            entries={orgEntries}
            reliabilityProfiles={reliabilityProfiles}
            knowledgeProfiles={profiles}
            recommendationTrends={recommendationTrends}
            loading={loading}
            projectCount={kpis.projectsAnalysed}
          />

          {!hasAnyData ? (
            <IntelligenceEmptyState
              icon={Brain}
              title="No completed projects imported yet"
              description="Rana compares completed projects with your current programme. Import your first completed project to begin organisational learning — lessons and patterns will appear here once there is enough to learn from."
              action={
                <IntelligenceEmptyStateButton onClick={() => void loadData(true)} disabled={loading}>
                  Refresh
                </IntelligenceEmptyStateButton>
              }
            />
          ) : null}

          {selectedProjectId ? (
            <ProjectIntelligenceOverview
              coverageWord={kpis.knowledgeMaturity}
              programmesLearnedFrom={kpis.projectsAnalysed}
            />
          ) : null}

          {/* Consolidated — What usually happens + what usually needs reviewing */}
          {(predictability.mostPredictable.length > 0 || reviewThemes.length > 0) && (
            <IntelligenceSection
              title="What usually happens"
              description="Which kinds of work tend to run to plan, and which most often need a closer look."
            >
              <div className="grid gap-6 lg:grid-cols-2">
                {predictability.mostPredictable.length > 0 ? (
                  <PredictabilityColumn
                    heading="Most predictable work"
                    hint="These types of work have behaved consistently before."
                    items={predictability.mostPredictable}
                  />
                ) : null}
                {predictability.leastPredictable.length > 0 ? (
                  <PredictabilityColumn
                    heading="Least predictable work"
                    hint="These vary the most, so plan them with extra care."
                    items={predictability.leastPredictable}
                  />
                ) : null}
              </div>

              {reviewThemes.length > 0 ? (
                <div className="mt-6 border-t border-slate-200 pt-5 dark:border-slate-700">
                  <h3 className="text-base font-semibold text-slate-900 dark:text-white">What usually needs reviewing</h3>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    The most common things Rana suggests double-checking, based on previous projects.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {reviewThemes.map((theme) => (
                      <span
                        key={theme.label}
                        className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200"
                      >
                        {theme.label}
                        <span className="ml-1.5 text-xs text-slate-400">×{theme.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </IntelligenceSection>
          )}

          {/* What Rana understands well / needs more history */}
          {profiles.length > 0 ? (
            <IntelligenceSection
              title="What Rana understands well"
              description="How much previous work each type is based on. Tap any type to see the detail."
            >
              <div className="space-y-6">
                {understanding.well.length > 0 ? (
                  <UnderstandingGroup
                    heading="Well understood"
                    hint="Plenty of similar work from several projects."
                    tone="good"
                    profiles={understanding.well}
                    onOpen={openType}
                  />
                ) : null}
                {understanding.reasonable.length > 0 ? (
                  <UnderstandingGroup
                    heading="Reasonably understood"
                    hint="A fair amount of history, growing all the time."
                    tone="moderate"
                    profiles={understanding.reasonable}
                    onOpen={openType}
                  />
                ) : null}
                {understanding.limited.length > 0 ? (
                  <UnderstandingGroup
                    heading="Needs more history"
                    hint="Based on limited history — importing more projects will help."
                    tone="low"
                    profiles={understanding.limited}
                    onOpen={openType}
                  />
                ) : null}
              </div>
            </IntelligenceSection>
          ) : null}
        </>
      )}

      <DeliverableTypeDetailDialog
        classification={detailClassification}
        data={data}
        onClose={() => setDetailClassification(null)}
      />
    </div>
  );
}

function UnderstandingGroup({
  heading,
  hint,
  tone,
  profiles,
  onOpen,
}: {
  heading: string;
  hint: string;
  tone: "good" | "moderate" | "low";
  profiles: DeliverableKnowledgeProfile[];
  onOpen: (classification: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h3 className="text-base font-semibold text-slate-900 dark:text-white">{heading}</h3>
        <span className={cn("rounded px-2 py-0.5 text-[10px] font-semibold uppercase", TONE_CLASSES[tone])}>
          {profiles.length}
        </span>
      </div>
      <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{hint}</p>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {profiles.map((p) => {
          const u = understandingFor(p);
          return (
            <ClickableTypeCard
              key={p.id}
              title={p.label}
              detail={`Typical duration: ${typicalDurationPhrase(p.medianDuration).toLowerCase()} · based on ${p.sampleSize} work package${p.sampleSize === 1 ? "" : "s"} from ${p.projectCount} project${p.projectCount === 1 ? "" : "s"}.`}
              badge={u.label}
              badgeTone={u.tone}
              onClick={() => onOpen(p.classification)}
            />
          );
        })}
      </div>
    </div>
  );
}
