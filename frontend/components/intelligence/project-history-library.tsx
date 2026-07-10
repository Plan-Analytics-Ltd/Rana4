"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Filter, History, Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getApiErrorMessage,
  programmeIntelligenceApi,
  type ProgrammeSnapshotSummary,
} from "@/lib/api";
import {
  humanSnapshotRole,
  humanSourceType,
  snapshotKnowledgeBadges,
} from "@/lib/intelligence-terminology";
import { IntelligenceEmptyState } from "@/components/intelligence/intelligence-empty-state";
import { IntelligenceKpiCard } from "@/components/intelligence/intelligence-kpi-card";
import { cn } from "@/lib/utils";
import { snapshotStoryFallbackLabel } from "@/lib/planner-language";

type Props = {
  projectId: string;
  projectName?: string;
};

function SnapshotCard({ snapshot, projectName }: { snapshot: ProgrammeSnapshotSummary; projectName?: string }) {
  const badges = snapshotKnowledgeBadges(snapshot);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/50">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-slate-900 dark:text-white">
            {snapshotStoryFallbackLabel({
              programmeDisplayName: snapshot.programmeDisplayName,
              label: snapshot.label,
              snapshotRole: snapshot.snapshotRole,
              snapshotVersion: snapshot.snapshotVersion,
            })}
          </h3>
          {projectName ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">{projectName}</p>
          ) : null}
        </div>
        <Badge variant="outline" className="text-xs">
          {humanSnapshotRole(snapshot.snapshotRole)}
        </Badge>
      </div>

      <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <span className="text-xs text-slate-500">Source</span>
          <p className="font-medium">{humanSourceType(snapshot.sourceType)}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Imported</span>
          <p className="font-medium">{new Date(snapshot.importedAt).toLocaleDateString()}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Deliverables</span>
          <p className="font-medium">{snapshot.deliverableCount}</p>
        </div>
        <div>
          <span className="text-xs text-slate-500">Activities</span>
          <p className="font-medium">{snapshot.activityCount}</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {badges.map((b) => (
          <Badge key={b} variant="secondary" className="text-[10px] font-normal">
            {b}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export function ProjectHistoryLibrary({ projectId, projectName }: Props) {
  const [snapshots, setSnapshots] = useState<ProgrammeSnapshotSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const snapRes = await programmeIntelligenceApi.listSnapshots(projectId);
      setSnapshots(snapRes.data.snapshots ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshots.filter((s) => {
      if (roleFilter !== "all" && s.snapshotRole !== roleFilter) return false;
      if (!q) return true;
      const hay = [
        s.label,
        s.sourceType,
        s.snapshotRole,
        humanSnapshotRole(s.snapshotRole),
        new Date(s.importedAt).toLocaleDateString(),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [snapshots, search, roleFilter]);

  const projectStats = useMemo(() => {
    const asBuilt = snapshots.filter((s) => s.snapshotRole === "AS_BUILT").length;
    const totalDeliverables = snapshots.reduce((s, x) => s + x.deliverableCount, 0);
    const totalActivities = snapshots.reduce((s, x) => s + x.activityCount, 0);
    return { asBuilt, totalDeliverables, totalActivities, count: snapshots.length };
  }, [snapshots]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading project evolution…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-900 dark:text-white">
          <History className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          Project evolution
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">
          Baseline and revision history for this project. Use this to understand what changed and when.
        </p>
      </div>

      {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <IntelligenceKpiCard label="Revisions in this project" value={projectStats.count} icon={History} tone="violet" />
        <IntelligenceKpiCard label="Completed programmes" value={projectStats.asBuilt} icon={Calendar} tone="emerald" />
        <IntelligenceKpiCard label="Deliverables captured" value={projectStats.totalDeliverables} tone="cyan" />
        <IntelligenceKpiCard label="Activities captured" value={projectStats.totalActivities} tone="cyan" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 max-w-md">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search revisions…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-slate-500" />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="all">All revisions</option>
            <option value="BASELINE">Baseline</option>
            <option value="LIVE_IMPORT">Programme update</option>
            <option value="AS_BUILT">As-built</option>
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          Refresh
        </Button>
      </div>

      {filtered.length === 0 ? (
        <IntelligenceEmptyState
          icon={History}
          title="No project evolution yet"
          description="Save a baseline and import programme updates over time. This creates the timeline used in Project Evolution."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {filtered.map((s) => (
            <SnapshotCard key={s.id} snapshot={s} projectName={projectName} />
          ))}
        </div>
      )}
    </div>
  );
}
