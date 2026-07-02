"use client";

import {
  Activity,
  BookOpen,
  Brain,
  Calendar,
  FolderKanban,
  Shield,
  Sparkles,
  Target,
} from "lucide-react";
import { IntelligenceKpiCard } from "@/components/intelligence/intelligence-kpi-card";
import type { OrgIntelligenceKpis } from "@/lib/intelligence-terminology";

type Props = {
  kpis: OrgIntelligenceKpis;
  variant?: "full" | "compact";
};

export function SummaryKpiGrid({ kpis, variant = "full" }: Props) {
  const latest = kpis.latestKnowledgeUpdate
    ? new Date(kpis.latestKnowledgeUpdate).toLocaleDateString()
    : "—";

  const items =
    variant === "compact"
      ? [
          { label: "Projects learned from", value: kpis.projectsAnalysed, icon: FolderKanban, tone: "violet" as const },
          { label: "Historical deliverables", value: kpis.historicalDeliverables, icon: BookOpen, tone: "cyan" as const },
          { label: "Average confidence", value: kpis.averageConfidencePercent != null ? `${kpis.averageConfidencePercent}%` : "—", icon: Target, tone: "emerald" as const },
          { label: "Latest update", value: latest, icon: Calendar, tone: "default" as const },
        ]
      : [
          { label: "Projects analysed", value: kpis.projectsAnalysed, icon: FolderKanban, tone: "violet" as const },
          { label: "Historical deliverables", value: kpis.historicalDeliverables, icon: BookOpen, tone: "cyan" as const },
          { label: "Historical activities", value: kpis.historicalActivities, icon: Activity, tone: "cyan" as const },
          { label: "Knowledge maturity", value: kpis.knowledgeMaturity, icon: Brain, tone: "amber" as const },
          { label: "Average confidence", value: kpis.averageConfidencePercent != null ? `${kpis.averageConfidencePercent}%` : "—", icon: Target, tone: "emerald" as const },
          { label: "Latest knowledge update", value: latest, icon: Calendar, tone: "default" as const },
          { label: "High-trust analyses", value: kpis.highTrustCount, icon: Shield, tone: "emerald" as const },
          { label: "Likely outcomes available", value: kpis.predictionsAvailable, icon: Sparkles, tone: "violet" as const },
        ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <IntelligenceKpiCard
          key={item.label}
          label={item.label}
          value={item.value}
          icon={item.icon}
          tone={item.tone}
        />
      ))}
    </div>
  );
}
