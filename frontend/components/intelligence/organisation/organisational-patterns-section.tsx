"use client";

import { Loader2, TrendingDown, TrendingUp, Waves } from "lucide-react";
import type {
  DeliverableKnowledgeProfile,
  DeliverableReliabilityProfile,
  OrganisationKnowledgeEntry,
  OrganisationalPattern,
  RecommendationTrendGroup,
} from "@/lib/api";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
import {
  adaptiveProjectsHeading,
  evidenceBasisPhrase,
  organisationalPatternLabel,
  orgKnowledgeCategoryLabel,
  reviewThemeLabel,
  typicalDurationPhrase,
  understandingFor,
} from "@/lib/intelligence-language";
import { cn } from "@/lib/utils";

type Props = {
  patterns: OrganisationalPattern[];
  entries: OrganisationKnowledgeEntry[];
  reliabilityProfiles: DeliverableReliabilityProfile[];
  knowledgeProfiles: DeliverableKnowledgeProfile[];
  recommendationTrends: RecommendationTrendGroup[];
  loading?: boolean;
  projectCount?: number;
};

function PatternCard({
  title,
  detail,
  meta,
  icon: Icon,
  tone,
}: {
  title: string;
  detail: string;
  meta: string;
  icon: typeof TrendingUp;
  tone: "growth" | "stable" | "risk" | "review";
}) {
  const toneClass = {
    growth: "border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20",
    stable: "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/20",
    risk: "border-rose-200 bg-rose-50/50 dark:border-rose-900/40 dark:bg-rose-950/20",
    review: "border-violet-200 bg-violet-50/50 dark:border-violet-900/40 dark:bg-violet-950/20",
  }[tone];

  return (
    <div className={cn("rounded-lg border p-4", toneClass)}>
      <div className="flex items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{detail}</p>
          <p className="mt-2 text-xs text-slate-500">{meta}</p>
        </div>
      </div>
    </div>
  );
}

export function OrganisationalPatternsSection({
  patterns,
  entries,
  reliabilityProfiles,
  knowledgeProfiles,
  recommendationTrends,
  loading,
  projectCount = 0,
}: Props) {
  const sectionTitle = adaptiveProjectsHeading(projectCount);
  const stableWork = entries
    .filter((e) => e.category.includes("stable"))
    .slice(0, 4);
  const growthPatterns = patterns.filter((p) => p.type === "REPEATED_SCOPE_GROWTH").slice(0, 4);
  const growthEntries = entries.filter((e) => e.category.includes("volatile")).slice(0, 4);
  const reductionPatterns = patterns.filter((p) => p.type === "REPEATED_DURATION_REDUCTION").slice(0, 4);
  const reductionEntries = entries.filter((e) => e.category.includes("reduced")).slice(0, 4);

  const underestimated = reliabilityProfiles
    .filter((p) => (p.overrunFrequency ?? 0) >= 0.4 && p.sampleSize >= 3)
    .sort((a, b) => b.overrunFrequency - a.overrunFrequency)
    .slice(0, 4);

  const mostReliable = knowledgeProfiles
    .filter((p) => p.learningMaturity === "WELL_KNOWN" && p.projectCount >= 2)
    .sort((a, b) => b.sampleSize - a.sampleSize)
    .slice(0, 4);

  const weakAreas = knowledgeProfiles
    .filter((p) => p.learningMaturity === "LIMITED" || p.projectCount <= 1)
    .slice(0, 4);

  const reviewThemes = recommendationTrends
    .map((g) => ({
      label: reviewThemeLabel(g.recommendationType, g.typeLabel),
      count: g.profiles.length,
    }))
    .filter((t) => t.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  const hasContent =
    stableWork.length > 0 ||
    growthPatterns.length > 0 ||
    growthEntries.length > 0 ||
    reductionPatterns.length > 0 ||
    reductionEntries.length > 0 ||
    underestimated.length > 0 ||
    mostReliable.length > 0 ||
    weakAreas.length > 0 ||
    reviewThemes.length > 0;

  if (loading && !hasContent) {
    return (
      <IntelligenceSection
        title={sectionTitle}
        description="Patterns from completed programmes — not statistics, but things worth knowing."
      >
        <p className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Looking for patterns across previous projects…
        </p>
      </IntelligenceSection>
    );
  }

  if (!hasContent) return null;

  return (
    <IntelligenceSection
      title={sectionTitle}
      description="Patterns Rana has seen again and again on completed programmes."
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {stableWork.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Most stable work types</h3>
            <p className="mt-0.5 text-xs text-slate-500">Usually stays close to plan across revisions.</p>
            <ul className="mt-3 space-y-2">
              {stableWork.map((e) => (
                <PatternCard
                  key={e.id}
                  title={e.label}
                  detail={e.summary}
                  meta={orgKnowledgeCategoryLabel(e.category)}
                  icon={Waves}
                  tone="stable"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {(growthPatterns.length > 0 || growthEntries.length > 0) ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Work that often grows</h3>
            <p className="mt-0.5 text-xs text-slate-500">Duration or scope tends to increase during the programme.</p>
            <ul className="mt-3 space-y-2">
              {growthPatterns.map((p) => (
                <PatternCard
                  key={`${p.type}-${p.deliverableName}`}
                  title={p.deliverableName}
                  detail={p.summary}
                  meta={`Seen on ${p.projectCount} project${p.projectCount === 1 ? "" : "s"}`}
                  icon={TrendingUp}
                  tone="growth"
                />
              ))}
              {growthEntries.map((e) => (
                <PatternCard
                  key={e.id}
                  title={e.label}
                  detail={e.summary}
                  meta={orgKnowledgeCategoryLabel(e.category)}
                  icon={TrendingUp}
                  tone="growth"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {(reductionPatterns.length > 0 || reductionEntries.length > 0) ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Work that is often reduced</h3>
            <p className="mt-0.5 text-xs text-slate-500">Frequently shortened before completion.</p>
            <ul className="mt-3 space-y-2">
              {reductionPatterns.map((p) => (
                <PatternCard
                  key={`${p.type}-${p.deliverableName}`}
                  title={p.deliverableName}
                  detail={p.summary}
                  meta={`Seen on ${p.projectCount} project${p.projectCount === 1 ? "" : "s"}`}
                  icon={TrendingDown}
                  tone="review"
                />
              ))}
              {reductionEntries.map((e) => (
                <PatternCard
                  key={e.id}
                  title={e.label}
                  detail={e.summary}
                  meta={orgKnowledgeCategoryLabel(e.category)}
                  icon={TrendingDown}
                  tone="review"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {underestimated.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Frequently underestimated work</h3>
            <p className="mt-0.5 text-xs text-slate-500">Planned durations often proved too short on previous projects.</p>
            <ul className="mt-3 space-y-2">
              {underestimated.map((p) => (
                <PatternCard
                  key={p.id}
                  title={p.label}
                  detail={`On previous projects, this work overran the plan about ${Math.round(p.overrunFrequency * 100)}% of the time.`}
                  meta={evidenceBasisPhrase(p.sampleSize, p.projectCount)}
                  icon={TrendingUp}
                  tone="risk"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {mostReliable.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Most reliable comparisons</h3>
            <p className="mt-0.5 text-xs text-slate-500">Well understood from several completed projects.</p>
            <ul className="mt-3 space-y-2">
              {mostReliable.map((p) => (
                <PatternCard
                  key={p.id}
                  title={p.label}
                  detail={`Typical duration: ${typicalDurationPhrase(p.medianDuration).toLowerCase()}.`}
                  meta={`${understandingFor(p).label} · ${p.projectCount} projects`}
                  icon={Waves}
                  tone="stable"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {weakAreas.length > 0 ? (
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">Areas with limited history</h3>
            <p className="mt-0.5 text-xs text-slate-500">Comparisons here should be treated as guidance only.</p>
            <ul className="mt-3 space-y-2">
              {weakAreas.map((p) => (
                <PatternCard
                  key={p.id}
                  title={p.label}
                  detail={`${evidenceBasisPhrase(p.sampleSize, p.projectCount)} so far.`}
                  meta={understandingFor(p).label}
                  icon={Waves}
                  tone="review"
                />
              ))}
            </ul>
          </div>
        ) : null}

        {reviewThemes.length > 0 ? (
          <div className="lg:col-span-2">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white">What usually needs reviewing</h3>
            <p className="mt-0.5 text-xs text-slate-500">Common review themes across previous projects.</p>
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
      </div>
    </IntelligenceSection>
  );
}
