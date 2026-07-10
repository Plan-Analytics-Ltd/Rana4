"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ArrowRight,
  FolderPlus,
  History,
  Loader2,
  Package,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProject } from "@/contexts/project-context";
import {
  deliverablesApi,
  getApiErrorMessage,
  programmeIntelligenceApi,
  type ProgrammeSnapshotSummary,
} from "@/lib/api";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";
import { DeliverableStatusBadge } from "@/components/intelligence/deliverable-status-badge";
import { useIntelligenceDrawer } from "@/contexts/intelligence-drawer-context";
import { RecentActivityCard } from "@/components/intelligence/dashboard/recent-activity-card";
import { planningWorkspaceHref } from "@/lib/intelligence-ui";
import { snapshotStoryFallbackLabel } from "@/lib/planner-language";

export default function PlannerDashboardPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const { openInsight } = useIntelligenceDrawer();
  const [deliverableIds, setDeliverableIds] = useState<string[]>([]);
  const [deliverableNames, setDeliverableNames] = useState<Map<string, string>>(new Map());
  const [snapshots, setSnapshots] = useState<ProgrammeSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const { snapshots: intelSnapshots, loading: intelLoading } = useDeliverableIntelligenceCache(
    selectedProjectId,
    deliverableIds
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const delPromise = selectedProjectId ? deliverablesApi.list(selectedProjectId) : Promise.resolve({ data: [] });
      const snapPromise = selectedProjectId
        ? programmeIntelligenceApi.listSnapshots(selectedProjectId)
        : Promise.resolve({ data: { snapshots: [] as ProgrammeSnapshotSummary[] } });

      const [del, snap] = await Promise.all([delPromise, snapPromise]);

      setDeliverableIds(del.data.map((d) => d.id));
      setDeliverableNames(new Map(del.data.map((d) => [d.id, d.name])));
      setSnapshots(
        [...(snap.data.snapshots ?? [])]
          .sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())
          .slice(0, 3)
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "The dashboard couldn’t load. Please try again in a moment.");
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

  const openDeliverable = (id: string, name: string) => {
    if (!selectedProjectId) return;
    openInsight({ projectId: selectedProjectId, deliverableId: id, deliverableName: name });
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-20 text-sm text-slate-500">
        <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
        Reviewing your programme…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          {selectedProject?.name ?? "Dashboard"}
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          What needs your attention today — deliverables to review, recent programme changes, and quick actions.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base">Deliverables worth reviewing</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Compared with similar work on completed projects — open one to see why.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/deliverables">
              All deliverables <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {intelLoading && reviewDeliverables.length === 0 ? (
            <p className="text-sm text-slate-500">Comparing deliverables with previous projects…</p>
          ) : reviewDeliverables.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Nothing stands out for review right now.{" "}
              <Link href="/app/intelligence" className="text-violet-600 underline dark:text-violet-400">
                See what Rana has learned
              </Link>{" "}
              from completed projects, or import more history to strengthen comparisons.
            </p>
          ) : (
            reviewDeliverables.map(({ id, name, snapshot }) => (
              <button
                key={id}
                type="button"
                onClick={() => openDeliverable(id, name)}
                className="flex w-full items-center justify-between gap-2 rounded-md border border-slate-200 px-3 py-2 text-left transition hover:border-violet-300 hover:bg-violet-50/40 dark:border-slate-700 dark:hover:border-violet-800 dark:hover:bg-violet-950/20"
              >
                <span className="truncate text-sm font-medium">{name}</span>
                <DeliverableStatusBadge snapshot={snapshot} />
              </button>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="border-slate-200/80 dark:border-slate-700">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-slate-700 dark:text-slate-200">
              <History className="h-4 w-4 text-slate-400" />
              How this project has changed
            </CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              Project Evolution — how this programme has changed over time. Separate from comparisons with other
              projects.
            </p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link href="/app/schedule">
              Project Evolution <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {snapshots.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">
              No programme revisions imported yet.{" "}
              <Link href="/app/import" className="text-violet-600 underline dark:text-violet-400">
                Import a baseline or programme update
              </Link>{" "}
              to start tracking how this project changes over time.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-3">
              {snapshots.map((s) => (
                <RecentActivityCard
                  key={s.id}
                  href="/app/schedule"
                  title={snapshotStoryFallbackLabel({
                    programmeDisplayName: s.programmeDisplayName,
                    label: s.label,
                    snapshotRole: s.snapshotRole,
                    snapshotVersion: s.snapshotVersion,
                  })}
                  subtitle={`${s.activityCount} activities · ${s.deliverableCount} deliverables`}
                  date={new Date(s.importedAt).toLocaleDateString()}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quick actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/app/deliverables">
              <Package className="mr-2 h-4 w-4" />
              Review deliverables
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href={planningWorkspaceHref({ view: "workspace" })}>
              Open Planning Workspace
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/intelligence">
              What Rana has learned
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/import">
              <Upload className="mr-2 h-4 w-4" />
              Import projects
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/app/projects/new">
              <FolderPlus className="mr-2 h-4 w-4" />
              New project
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
