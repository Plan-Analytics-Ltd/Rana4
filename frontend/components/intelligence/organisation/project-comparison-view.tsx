"use client";

import { Loader2 } from "lucide-react";
import type { LearnedInsight, SimilarProjectMatch } from "@/lib/api";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
import {
  lessonFromInsight,
  projectSimilarityPhrase,
  projectSimilaritySummary,
} from "@/lib/intelligence-language";

type Props = {
  currentProjectName: string;
  matches: SimilarProjectMatch[];
  insights: LearnedInsight[];
  loading?: boolean;
};

function lessonsForComparison(insights: LearnedInsight[], limit = 2): string[] {
  return insights
    .slice()
    .sort((a, b) => b.sampleSize - a.sampleSize)
    .slice(0, limit)
    .map((i) => {
      const lesson = lessonFromInsight(i);
      return lesson.detail;
    });
}

export function ProjectComparisonView({
  currentProjectName,
  matches,
  insights,
  loading,
}: Props) {
  const comparable = matches.filter((m) => m.similarityScore > 0);

  if (loading && comparable.length === 0) {
    return (
      <div className="flex items-center gap-2 py-12 text-sm text-slate-500">
        <Loader2 className="h-5 w-5 animate-spin" />
        Comparing with previous projects…
      </div>
    );
  }

  if (comparable.length === 0) {
    return (
      <IntelligenceSection
        title="Projects Rana compared"
        description="Rana looks for completed projects with similar sector, type, stage, and work mix."
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          No completed projects have been imported yet. Rana compares completed projects with your current programme.
          Import your first completed project to begin organisational learning.
        </p>
      </IntelligenceSection>
    );
  }

  const orgLessons = lessonsForComparison(insights, 6);

  return (
    <div className="space-y-6">
      <IntelligenceSection
        title="Projects Rana compared"
        description={`How ${currentProjectName} compares with similar completed projects in your organisation.`}
      >
        <div className="space-y-4">
          {comparable.map((match) => {
            const keyLessons = orgLessons.slice(0, 2);
            const differences =
              match.similarityScore < 55
                ? "Some programme characteristics differ — treat comparisons as directional rather than exact."
                : null;

            return (
              <div
                key={match.projectId}
                className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{match.projectName}</h3>
                    <p className="mt-1 text-sm text-slate-500">
                      {projectSimilarityPhrase(match.similarityScore)} to {currentProjectName}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Main similarities</h4>
                    <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">
                      {projectSimilaritySummary(match)}
                    </p>
                  </div>
                  {differences ? (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Things to bear in mind
                      </h4>
                      <p className="mt-1 text-sm text-slate-700 dark:text-slate-200">{differences}</p>
                    </div>
                  ) : null}
                </div>

                {keyLessons.length > 0 ? (
                  <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-700">
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Relevant lessons from previous projects
                    </h4>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-300">
                      {keyLessons.map((lesson, idx) => (
                        <li key={idx}>{lesson}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </IntelligenceSection>
    </div>
  );
}
