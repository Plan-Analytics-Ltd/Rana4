"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useProject } from "@/contexts/project-context";
import { deliverablesApi, organisationalIntelligenceApi } from "@/lib/api";
import { computeOrgKpis } from "@/lib/intelligence-terminology";
import { useEffect, useState } from "react";
import { IntelligenceHelpTooltip } from "@/components/intelligence/intelligence-help-tooltip";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";

type Props = {
  projectId?: string | null;
  className?: string;
};

export function ProjectHealthBar({ projectId: projectIdProp, className }: Props) {
  const { selectedProjectId } = useProject();
  const projectId = projectIdProp ?? selectedProjectId;
  const [deliverableIds, setDeliverableIds] = useState<string[]>([]);
  const [orgMaturity, setOrgMaturity] = useState<string>("—");
  const [lastUpdate, setLastUpdate] = useState<string>("—");

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
    let cancelled = false;
    void organisationalIntelligenceApi.dashboard().then(({ data }) => {
      if (cancelled) return;
      const kpis = computeOrgKpis(data);
      setOrgMaturity(kpis.knowledgeMaturity);
      setLastUpdate(
        kpis.latestKnowledgeUpdate
          ? new Date(kpis.latestKnowledgeUpdate).toLocaleDateString()
          : "—"
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const { snapshots, loading } = useDeliverableIntelligenceCache(projectId, deliverableIds);

  const summary = useMemo(() => {
    const values = [...snapshots.values()];
    const reviewCount = values.filter((s) => s.attention === "review" || s.attention === "high_risk").length;
    const alignedCount = values.filter((s) => s.attention === "aligned").length;
    const recommendations = values.reduce((n, s) => n + s.recommendationCount, 0);
    const limitedCount = values.filter((s) => s.attention === "limited").length;

    let scheduleConfidence = "Building";
    if (values.length > 0) {
      const alignedRatio = alignedCount / values.length;
      if (alignedRatio >= 0.6) scheduleConfidence = "Good";
      else if (alignedRatio >= 0.35) scheduleConfidence = "Moderate";
      else if (limitedCount === values.length) scheduleConfidence = "Limited evidence";
      else scheduleConfidence = "Needs attention";
    }

    let evidenceQuality = "Limited";
    const withTrust = values.filter((s) => s.trustLabel);
    if (withTrust.some((s) => s.trustLabel?.toLowerCase().includes("high"))) evidenceQuality = "Strong";
    else if (withTrust.length > 0) evidenceQuality = "Moderate";

    let historicalAlignment = "Not assessed";
    if (values.some((s) => s.hasComparison)) {
      if (reviewCount === 0 && alignedCount > 0) historicalAlignment = "Mostly aligned";
      else if (reviewCount > 0) historicalAlignment = `${reviewCount} need review`;
      else historicalAlignment = "Mixed";
    }

    return {
      scheduleConfidence,
      reviewCount,
      historicalAlignment,
      recommendations,
      evidenceQuality,
    };
  }, [snapshots]);

  if (!projectId) {
    return (
      <div className={`rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-500 dark:border-slate-600 ${className ?? ""}`}>
        Select a project to see project health.
      </div>
    );
  }

  const items = [
    { label: "Schedule confidence", value: summary.scheduleConfidence, help: "scheduleConfidence" as const },
    { label: "Needs review", value: summary.reviewCount > 0 ? String(summary.reviewCount) : "None", help: null },
    { label: "Historical alignment", value: summary.historicalAlignment, help: "historicalComparison" as const },
    { label: "Recommendations", value: summary.recommendations > 0 ? String(summary.recommendations) : "None", help: "recommendations" as const },
    { label: "Evidence quality", value: summary.evidenceQuality, help: "evidenceQuality" as const },
    { label: "What we've learned", value: orgMaturity, help: "whatWeLearned" as const },
    { label: "Last update", value: lastUpdate, help: null },
  ];

  return (
    <div
      className={`rounded-lg border border-violet-200/80 bg-violet-50/40 px-4 py-3 dark:border-violet-900/40 dark:bg-violet-950/20 ${className ?? ""}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Project health</h2>
        {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" /> : null}
        <IntelligenceHelpTooltip topic="scheduleConfidence" />
      </div>
      <p className="mb-3 text-xs text-slate-600 dark:text-slate-400">
        What needs your attention on this project, based on imported history.
      </p>
      <div className="flex flex-wrap gap-2">
        {items.map((item) => (
          <Badge
            key={item.label}
            variant="secondary"
            className="gap-1 font-normal text-slate-700 dark:text-slate-200"
          >
            <span className="text-slate-500">{item.label}:</span>
            <span className="font-medium">{item.value}</span>
            {item.help ? <IntelligenceHelpTooltip topic={item.help} /> : null}
          </Badge>
        ))}
      </div>
    </div>
  );
}
