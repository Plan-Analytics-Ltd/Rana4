"use client";

import Link from "next/link";
import { ArrowRight, Building2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SimilarProjectMatch } from "@/lib/api";
import { projectSimilarityPhrase, projectSimilaritySummary } from "@/lib/intelligence-language";
import { cn } from "@/lib/utils";

type Props = {
  matches: SimilarProjectMatch[];
  loading?: boolean;
  comparisonHref?: string;
  className?: string;
  limit?: number;
};

export function SimilarProjectsCard({
  matches,
  loading,
  comparisonHref = "/app/intelligence/comparison",
  className,
  limit = 5,
}: Props) {
  const visible = matches.filter((m) => m.similarityScore > 0).slice(0, limit);

  return (
    <Card className={cn("border-violet-200/70 dark:border-violet-900/40", className)}>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Building2 className="h-4 w-4 text-violet-600 dark:text-violet-400" />
          Projects most like yours
        </CardTitle>
        {visible.length > 0 ? (
          <Button asChild variant="ghost" size="sm">
            <Link href={comparisonHref}>
              Compare <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {loading && visible.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" />
            Finding similar completed projects…
          </p>
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No completed projects have been imported yet. Rana compares completed projects with your current programme.{" "}
            <Link href="/app/import" className="text-violet-600 underline dark:text-violet-400">
              Import your first completed project
            </Link>{" "}
            to start comparing.
          </p>
        ) : (
          <ul className="space-y-2">
            {visible.map((match) => (
              <li key={match.projectId}>
                <Link
                  href={comparisonHref}
                  className="group flex items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 transition hover:border-violet-300 hover:shadow-sm dark:border-slate-700 dark:bg-slate-900/50 dark:hover:border-violet-800"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{match.projectName}</div>
                    <p className="mt-0.5 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">
                      {projectSimilaritySummary(match)}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-violet-800 dark:bg-violet-900/40 dark:text-violet-200">
                    {projectSimilarityPhrase(match.similarityScore)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
