"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  Brain,
  FolderPlus,
  Loader2,
  Package,
  Sparkles,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProject } from "@/contexts/project-context";
import {
  deliverablesApi,
  getApiErrorMessage,
  organisationalIntelligenceApi,
  programmeIntelligenceApi,
  type LearnedInsight,
  type ProgrammeSnapshotSummary,
} from "@/lib/api";
import { ProjectHealthBar } from "@/components/intelligence/project-health-bar";
import { SummaryKpiGrid } from "@/components/intelligence/dashboard/summary-kpi-grid";
import { computeOrgKpis } from "@/lib/intelligence-terminology";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";
import { DeliverableStatusBadge } from "@/components/intelligence/deliverable-status-badge";
import { useIntelligenceDrawer } from "@/contexts/intelligence-drawer-context";
import { LearningSummaryCard } from "@/components/intelligence/dashboard/learning-summary-card";
import { RecommendationHighlightCard } from "@/components/intelligence/dashboard/recommendation-highlight-card";
import { RecentActivityCard } from "@/components/intelligence/dashboard/recent-activity-card";

export default function PlannerDashboardPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const { openInsight } = useIntelligenceDrawer();
  const [deliverableIds, setDeliverableIds] = useState<string[]>([]);
  const [deliverableNames, setDeliverableNames] = useState<Map<string, string>>(new Map());
  const [insights, setInsights] = useState<LearnedInsight[]>([]);
  const [orgKpis, setOrgKpis] = useState(() =>
    computeOrgKpis({
      insights: [],
      deliverableProfiles: [],
      reliabilityProfiles: [],
      outcomeProfiles: [],
      recommendationProfiles: [],
      recommendationTrends: [],
      trustProfiles: [],
    })
  );
  const [snapshots, setSnapshots] = useState<ProgrammeSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const { snapshots: intelSnapshots, loading: intelLoading } = useDeliverableIntelligenceCache(
    selectedProjectId,
    deliverableIds
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const dashPromise = organisationalIntelligenceApi.dashboard();
      const delPromise = selectedProjectId ? deliverablesApi.list(selectedProjectId) : Promise.resolve({ data: [] });
      const snapPromise = selectedProjectId
        ? programmeIntelligenceApi.listSnapshots(selectedProjectId)
        : Promise.resolve({ data: { snapshots: [] as ProgrammeSnapshotSummary[] } });

      const [dash, del, snap] = await Promise.all([dashPromise, delPromise, snapPromise]);
      setInsights((dash.data.insights ?? []).slice(0, 4));
      setOrgKpis(computeOrgKpis(dash.data));
      setDeliverableIds(del.data.map((d) => d.id));
      setDeliverableNames(new Map(del.data.map((d) => [d.id, d.name])));
      setSnapshots(
        [...(snap.data.snapshots ?? [])]
          .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
          .slice(0, 4)
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const reviewDeliverables = useMemo(() => {
    return [...intelSnapshots.entries()]
      .filter(([, s]) => s.attention === "review" || s.attention === "high_risk")
      .map(([id, s]) => ({ id, name: deliverableNames.get(id) ?? s.deliverableName, snapshot: s }))
      .slice(0, 6);
  }, [intelSnapshots, deliverableNames]);

  const topRecommendations = useMemo(() => {
    return [...intelSnapshots.entries()]
      .filter(([, s]) => s.recommendationCount > 0)
      .sort((a, b) => b[1].recommendationCount - a[1].recommendationCount)
      .slice(0, 3)
      .map(([id, s]) => ({
        id,
        name: deliverableNames.get(id) ?? s.deliverableName,
        count: s.recommendationCount,
      }));
  }, [intelSnapshots, deliverableNames]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {selectedProject?.name ?? "Planner dashboard"}
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          What needs attention, what has changed, and what Rana4 has learned — at a glance.
        </p>
      </div>

      <ProjectHealthBar projectId={selectedProjectId} />

      <section>
        <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-slate-500">Organisation</h2>
        <SummaryKpiGrid kpis={orgKpis} variant="compact" />
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Deliverables requiring review</CardTitle>
            <Button asChild variant="ghost" size="sm">
              <Link href="/app/deliverables">
                View all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {intelLoading && reviewDeliverables.length === 0 ? (
              <p className="text-sm text-slate-500">Checking deliverables…</p>
            ) : reviewDeliverables.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Rana4 has not flagged any deliverables for review on this project. Import more completed project
                history to strengthen comparisons.
              </p>
            ) : (
              reviewDeliverables.map(({ id, name, snapshot }) => (
                <div key={id} className="flex items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                  <span className="text-sm font-medium">{name}</span>
                  <DeliverableStatusBadge
                    snapshot={snapshot}
                    onClick={() =>
                      selectedProjectId &&
                      openInsight({ projectId: selectedProjectId, deliverableId: id, deliverableName: name })
                    }
                  />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent imports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {snapshots.length === 0 ? (
              <p className="text-sm text-slate-600 dark:text-slate-400">
                No programme history imported for this project yet.{" "}
                <Link href="/app/import" className="text-violet-600 underline dark:text-violet-400">
                  Import completed project history
                </Link>{" "}
                to build organisational knowledge.
              </p>
            ) : (
              snapshots.map((s) => (
                <RecentActivityCard
                  key={s.id}
                  title={s.label || `Snapshot v${s.snapshotVersion}`}
                  subtitle={`${s.activityCount} activities · ${s.deliverableCount} deliverables`}
                  date={new Date(s.importedAt).toLocaleDateString()}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Brain className="h-4 w-4 text-violet-600" />
            Latest organisational learning
          </CardTitle>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/intelligence">What we&apos;ve learned</Link>
          </Button>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-2">
          {insights.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400 lg:col-span-2">
              No organisational patterns yet. Import completed programmes across projects to help Rana4 learn.
            </p>
          ) : (
            insights.map((i) => (
              <LearningSummaryCard
                key={i.id}
                title={i.title}
                summary={i.summary}
                confidenceLevel={i.confidenceLevel}
                sampleSize={i.sampleSize}
              />
            ))
          )}
        </CardContent>
      </Card>

      {topRecommendations.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-violet-600" />
              Recommendations to review
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {topRecommendations.map((r) => (
              <RecommendationHighlightCard
                key={r.id}
                title={r.name}
                recommendation={`${r.count} evidence-based recommendation${r.count === 1 ? "" : "s"} available`}
                evidenceCount={r.count}
              />
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/projects/new">
              <FolderPlus className="mr-2 h-4 w-4" />
              New project from XER
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/deliverables">
              <Package className="mr-2 h-4 w-4" />
              Deliverable analysis
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/import">
              <Upload className="mr-2 h-4 w-4" />
              Import history
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/schedule">Project history</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/intelligence">Organisation learning</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
