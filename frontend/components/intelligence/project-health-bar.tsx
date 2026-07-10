"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useProject } from "@/contexts/project-context";
import { deliverablesApi, programmeIntelligenceApi } from "@/lib/api";
import { IntelligenceHelpTooltip } from "@/components/intelligence/intelligence-help-tooltip";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";
import {
  previousProjectsComparisonStateLabel,
  projectEvolutionStateLabel,
} from "@/lib/intelligence-language";

type Props = {
  projectId?: string | null;
  className?: string;
};

export function ProjectHealthBar({ projectId: projectIdProp, className }: Props) {
  const { selectedProjectId } = useProject();
  const projectId = projectIdProp ?? selectedProjectId;
  const [deliverableIds, setDeliverableIds] = useState<string[]>([]);
  const [revisionCount, setRevisionCount] = useState(0);
  const [revisionsLoading, setRevisionsLoading] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setDeliverableIds([]);
      return;
    }
    let cancelled = false;
    void deliverablesApi.list(projectId).then(({ data }) => {
      if (!cancelled) setDeliverableIds(data.map((d) => d.id));
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      setRevisionCount(0);
      return;
    }
    let cancelled = false;
    setRevisionsLoading(true);
    void programmeIntelligenceApi
      .listSnapshots(projectId)
      .then(({ data }) => {
        if (!cancelled) setRevisionCount(data.snapshots?.length ?? 0);
      })
      .catch(() => {
        if (!cancelled) setRevisionCount(0);
      })
      .finally(() => {
        if (!cancelled) setRevisionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const { snapshots, loading } = useDeliverableIntelligenceCache(projectId, deliverableIds);

  const summary = useMemo(() => {
    const values = [...snapshots.values()];
    const reviewCount = values.filter((s) => s.attention === "review" || s.attention === "high_risk").length;
    const alignedCount = values.filter((s) => s.attention === "aligned").length;
    const recommendations = values.reduce((n, s) => n + s.recommendationCount, 0);
    const hasComparison = values.some((s) => s.hasComparison);
    const completedProjectSignals = values.filter((s) => s.hasComparison).length;

    let reliability = "Still learning";
    if (values.length > 0) {
      const alignedRatio = alignedCount / values.length;
      if (hasComparison && alignedRatio >= 0.6) reliability = "Good";
      else if (hasComparison && alignedRatio >= 0.35) reliability = "Moderate";
      else if (!hasComparison) reliability = "Awaiting completed projects";
      else reliability = "Needs attention";
    }

    const evolution = projectEvolutionStateLabel(revisionCount);
    const comparison = previousProjectsComparisonStateLabel({
      hasComparison,
      completedProjectCount: hasComparison ? Math.max(1, completedProjectSignals) : 0,
      reviewCount,
    });

    return { reliability, reviewCount, evolution, comparison, recommendations, hasComparison };
  }, [snapshots, revisionCount]);

  if (!projectId) {
    return (
      <div className={`rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-600 ${className ?? ""}`}>
        Select a project to see project health.
      </div>
    );
  }

  const busy = loading || revisionsLoading;

  return (
    <div
      className={`rounded-lg border border-violet-200/80 bg-violet-50/40 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/20 ${className ?? ""}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Project health</h2>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
      </div>
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
        Two separate things: what Rana knows about <strong>this project’s revisions</strong>, and what it knows from{" "}
        <strong>other completed projects</strong>.
      </p>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
            {revisionCount > 0 ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-slate-400" />
            )}
            Project Evolution
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{summary.evolution.label}</div>
          <p className="mt-0.5 text-xs text-slate-500">{summary.evolution.detail}</p>
        </div>
        <div className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200">
            {summary.hasComparison ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-slate-400" />
            )}
            Previous Project Comparison
          </div>
          <div className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-white">{summary.comparison.label}</div>
          <p className="mt-0.5 text-xs text-slate-500">{summary.comparison.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant="secondary" className="gap-1 font-normal text-slate-700 dark:text-slate-200">
          <span className="text-slate-500">Worth reviewing:</span>
          <span className="font-medium">{summary.reviewCount > 0 ? String(summary.reviewCount) : "None"}</span>
        </Badge>
        <Badge variant="secondary" className="gap-1 font-normal text-slate-700 dark:text-slate-200">
          <span className="text-slate-500">Suggestions:</span>
          <span className="font-medium">{summary.recommendations > 0 ? String(summary.recommendations) : "None"}</span>
          <IntelligenceHelpTooltip topic="recommendations" />
        </Badge>
        <Badge variant="secondary" className="gap-1 font-normal text-slate-700 dark:text-slate-200">
          <span className="text-slate-500">How reliable is this:</span>
          <span className="font-medium">{summary.reliability}</span>
          <IntelligenceHelpTooltip topic="scheduleConfidence" />
        </Badge>
      </div>
    </div>
  );
}
