"use client";

import { useMemo } from "react";
import { ArrowRight, CheckCircle2, HelpCircle, Loader2, TriangleAlert } from "lucide-react";
import { useProject } from "@/contexts/project-context";
import { deliverablesApi } from "@/lib/api";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";
import { useIntelligenceDrawerOptional } from "@/contexts/intelligence-drawer-context";
import { useEffect, useState } from "react";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";
import { cn } from "@/lib/utils";

type Props = {
  /** Plain-English coverage word from org knowledge (e.g. "Well established"). */
  coverageWord: string;
  /** Number of previous programmes Rana has learned from. */
  programmesLearnedFrom: number;
};

type HealthTone = "good" | "moderate" | "low" | "neutral";

const TONE_TEXT: Record<HealthTone, string> = {
  good: "text-emerald-700 dark:text-emerald-300",
  moderate: "text-amber-700 dark:text-amber-300",
  low: "text-rose-700 dark:text-rose-300",
  neutral: "text-slate-700 dark:text-slate-200",
};

function HealthTile({
  value,
  label,
  tone = "neutral",
}: {
  value: string;
  label: string;
  tone?: HealthTone;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className={cn("text-2xl font-semibold", TONE_TEXT[tone])}>{value}</div>
      <div className="mt-1 text-xs leading-snug text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

function DeliverableList({
  title,
  hint,
  items,
  emptyText,
  accent,
  onOpen,
}: {
  title: string;
  hint: string;
  items: DeliverableStatusSnapshot[];
  emptyText: string;
  accent: string;
  onOpen?: (deliverableId: string, deliverableName: string) => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex items-center gap-2">
        <span className={cn("h-2.5 w-2.5 rounded-full", accent)} />
        <h4 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h4>
      </div>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-400 dark:text-slate-500">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {items.slice(0, 5).map((s) => (
            <li key={s.deliverableId}>
              <button
                type="button"
                onClick={() => onOpen?.(s.deliverableId, s.deliverableName)}
                disabled={!onOpen}
                className="group flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-slate-50 disabled:cursor-default dark:hover:bg-slate-800/60"
              >
                <span className="truncate text-slate-700 dark:text-slate-200">{s.deliverableName}</span>
                {onOpen ? (
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 group-hover:text-slate-500 dark:text-slate-600" />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectIntelligenceOverview({ coverageWord, programmesLearnedFrom }: Props) {
  const { selectedProjectId } = useProject();
  const drawer = useIntelligenceDrawerOptional();
  const [deliverableIds, setDeliverableIds] = useState<string[]>([]);

  const openDeliverable = (deliverableId: string, deliverableName: string) => {
    if (!selectedProjectId || !drawer) return;
    drawer.openInsight({ projectId: selectedProjectId, deliverableId, deliverableName });
  };

  useEffect(() => {
    if (!selectedProjectId) {
      setDeliverableIds([]);
      return;
    }
    let cancelled = false;
    void deliverablesApi.list(selectedProjectId).then(({ data }) => {
      if (!cancelled) setDeliverableIds(data.map((d) => d.id));
    });
    return () => {
      cancelled = true;
    };
  }, [selectedProjectId]);

  const { snapshots, loading } = useDeliverableIntelligenceCache(selectedProjectId, deliverableIds);

  const model = useMemo(() => {
    const values = [...snapshots.values()];
    const total = values.length;

    const matching = values.filter((s) => s.attention === "aligned");
    const review = values.filter((s) => s.attention === "review");
    const significant = values.filter((s) => s.attention === "high_risk");
    const weakEvidence = values
      .filter((s) => s.attention === "limited" || s.confidenceLevel === "LOW")
      .sort((a, b) => Number(a.hasComparison) - Number(b.hasComparison));
    const strongEvidence = values.filter(
      (s) => s.confidenceLevel === "HIGH" || (s.trustLabel?.toLowerCase().includes("high") ?? false)
    );

    const compared = values.filter((s) => s.hasComparison).length;
    const needsAttention = review.length + significant.length;

    let verdict = "Awaiting completed projects";
    let verdictTone: HealthTone = "neutral";
    let verdictDetail =
      "Project updates may be available on this programme, but Rana needs completed projects imported before it can compare.";
    if (total > 0 && compared > 0) {
      const attentionRatio = needsAttention / total;
      if (significant.length === 0 && attentionRatio <= 0.15) {
        verdict = "This programme looks healthy";
        verdictTone = "good";
        verdictDetail = "Most deliverables line up with how similar work has gone before.";
      } else if (attentionRatio <= 0.4) {
        verdict = "A few areas are worth a look";
        verdictTone = "moderate";
        verdictDetail = "Most work is on track, but some deliverables differ from previous projects.";
      } else {
        verdict = "Several areas need attention";
        verdictTone = "low";
        verdictDetail = "A number of deliverables differ from how similar work has gone before.";
      }
    }

    let reliabilityWord = "Being learned";
    const reliableShare =
      total > 0 ? values.filter((s) => s.confidenceLevel === "HIGH" || s.confidenceLevel === "MEDIUM").length / total : 0;
    if (compared > 0) {
      if (reliableShare >= 0.6) reliabilityWord = "Reliable";
      else if (reliableShare >= 0.3) reliabilityWord = "Fairly reliable";
      else reliabilityWord = "Early indication";
    }

    return {
      total,
      matching,
      review,
      significant,
      weakEvidence,
      strongEvidence,
      compared,
      verdict,
      verdictTone,
      verdictDetail,
      reliabilityWord,
    };
  }, [snapshots]);

  if (!selectedProjectId) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-600">
        Select a project to see how healthy it looks against previous projects.
      </div>
    );
  }

  const VerdictIcon =
    model.verdictTone === "good" ? CheckCircle2 : model.verdictTone === "low" ? TriangleAlert : HelpCircle;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-violet-200/70 bg-gradient-to-br from-violet-50 to-white p-5 dark:border-violet-900/40 dark:from-violet-950/30 dark:to-slate-900/50">
        <div className="flex items-start gap-3">
          <VerdictIcon
            className={cn(
              "mt-0.5 h-6 w-6 shrink-0",
              model.verdictTone === "good"
                ? "text-emerald-600 dark:text-emerald-400"
                : model.verdictTone === "low"
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-amber-600 dark:text-amber-400"
            )}
          />
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-900 dark:text-white">
              {model.verdict}
              {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
            </h3>
            <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{model.verdictDetail}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <HealthTile value={String(model.matching.length)} label="Deliverables matching previous projects" tone="good" />
          <HealthTile value={String(model.review.length)} label="Deliverables worth reviewing" tone="moderate" />
          <HealthTile
            value={String(model.significant.length)}
            label="Deliverables showing significant differences"
            tone="low"
          />
          <HealthTile value={model.reliabilityWord} label="How reliable this intelligence is" />
          <HealthTile
            value={`${model.compared} of ${model.total}`}
            label="Deliverables with similar work from previous projects"
          />
        </div>
        <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
          Rana has learned from {programmesLearnedFrom} previous programme{programmesLearnedFrom === 1 ? "" : "s"} —
          overall understanding: {coverageWord.toLowerCase()}.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <DeliverableList
          title="Worth reviewing first"
          hint="These differ most from previous projects."
          items={[...model.significant, ...model.review]}
          emptyText="Nothing stands out for review right now."
          accent="bg-rose-500"
          onOpen={drawer ? openDeliverable : undefined}
        />
        <DeliverableList
          title="Matching previous projects"
          hint="These line up with how similar work has gone before."
          items={model.matching}
          emptyText="No completed projects available for comparison yet."
          accent="bg-emerald-500"
          onOpen={drawer ? openDeliverable : undefined}
        />
        <DeliverableList
          title="Least project history"
          hint="Rana has little to compare these against."
          items={model.weakEvidence}
          emptyText="No completed projects imported yet — comparisons will appear once history is available."
          accent="bg-slate-400"
          onOpen={drawer ? openDeliverable : undefined}
        />
        <DeliverableList
          title="Strongest historical support"
          hint="Backed by plenty of similar previous work."
          items={model.strongEvidence}
          emptyText="Strong support will build as more history is imported."
          accent="bg-violet-500"
          onOpen={drawer ? openDeliverable : undefined}
        />
      </div>
    </div>
  );
}
