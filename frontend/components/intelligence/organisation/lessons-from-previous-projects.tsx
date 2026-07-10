"use client";

import Link from "next/link";
import { ArrowRight, BookOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LearnedInsight, LessonFinding, OrganisationalPattern } from "@/lib/api";
import {
  lessonFromInsight,
  lessonEvidencePhrase,
  organisationalPatternLabel,
  reliabilityWord,
} from "@/lib/intelligence-language";
import { cn } from "@/lib/utils";

export type LessonItem = {
  id: string;
  title: string;
  detail: string;
  sampleSize: number;
  projectCount?: number;
  reliability?: string;
};

type Props = {
  insights: LearnedInsight[];
  findings?: LessonFinding[];
  patterns?: OrganisationalPattern[];
  loading?: boolean;
  seeAllHref?: string;
  className?: string;
  limit?: number;
};

function buildLessons(
  insights: LearnedInsight[],
  findings: LessonFinding[],
  patterns: OrganisationalPattern[],
  limit: number
): LessonItem[] {
  const items: LessonItem[] = [];

  for (const insight of insights) {
    const lesson = lessonFromInsight(insight);
    items.push({
      id: `insight-${insight.id}`,
      title: lesson.title,
      detail: lesson.detail,
      sampleSize: lesson.sampleSize,
      reliability: reliabilityWord(insight.confidenceLevel),
    });
  }

  for (const finding of findings) {
    items.push({
      id: `finding-${finding.id}`,
      title: finding.title,
      detail: finding.summary,
      sampleSize: finding.sampleSize,
    });
  }

  for (const pattern of patterns) {
    items.push({
      id: `pattern-${pattern.type}-${pattern.deliverableName}`,
      title: `${pattern.deliverableName} — ${organisationalPatternLabel(pattern.type, pattern.label)}`,
      detail: pattern.summary,
      sampleSize: pattern.occurrenceCount,
      projectCount: pattern.projectCount,
      reliability:
        pattern.projectCount >= 3
          ? "Reliable"
          : pattern.projectCount >= 2
            ? "Fairly reliable"
            : "Early indication",
    });
  }

  return items
    .sort((a, b) => b.sampleSize - a.sampleSize)
    .slice(0, limit);
}

export function LessonsFromPreviousProjects({
  insights,
  findings = [],
  patterns = [],
  loading,
  seeAllHref = "/app/intelligence",
  className,
  limit = 6,
}: Props) {
  const lessons = buildLessons(insights, findings, patterns, limit);

  return (
    <Card className={cn(className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <BookOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Lessons from previous projects
        </CardTitle>
        {lessons.length > 0 && seeAllHref ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={seeAllHref}>
              See all <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading && lessons.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Reviewing what previous projects have taught us…
          </p>
        ) : lessons.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No completed projects have been imported yet. Rana compares completed projects with your current programme.{" "}
            <Link href="/app/import" className="text-violet-600 underline dark:text-violet-400">
              Import your first completed project
            </Link>{" "}
            to begin organisational learning.
          </p>
        ) : (
          <ul className="space-y-3">
            {lessons.map((lesson) => (
              <li
                key={lesson.id}
                className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-700 dark:bg-slate-800/30"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{lesson.title}</h3>
                  {lesson.reliability ? (
                    <span className="shrink-0 text-[10px] font-medium uppercase text-slate-400">
                      {lesson.reliability}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{lesson.detail}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {lessonEvidencePhrase(lesson.sampleSize, lesson.projectCount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
