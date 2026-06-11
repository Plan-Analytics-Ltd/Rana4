"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronUp, History, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  getApiErrorMessage,
  programmeIntelligenceApi,
  type PlannedVsActualReport,
  type ProgrammeSnapshotSummary,
} from "@/lib/api";

type Props = {
  projectId: string;
  canEdit: boolean;
};

export function ProgrammeIntelligencePanel({ projectId, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [snapshots, setSnapshots] = useState<ProgrammeSnapshotSummary[]>([]);
  const [baselineId, setBaselineId] = useState<string>("");
  const [pva, setPva] = useState<PlannedVsActualReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSnapshots = useCallback(async () => {
    if (!projectId) return;
    try {
      const res = await programmeIntelligenceApi.listSnapshots(projectId);
      setSnapshots(res.data.snapshots);
      const baseline = res.data.snapshots.find((s) => s.snapshotRole === "BASELINE");
      if (baseline) {
        setBaselineId((current) => current || baseline.id);
      }
    } catch (err) {
      setError(getApiErrorMessage(err));
    }
  }, [projectId]);

  useEffect(() => {
    setBaselineId("");
  }, [projectId]);

  useEffect(() => {
    if (open) void loadSnapshots();
  }, [open, loadSnapshots]);

  const runComparison = async () => {
    if (!baselineId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await programmeIntelligenceApi.plannedVsActual(projectId, {
        baselineSnapshotId: baselineId,
        compareToLive: true,
      });
      setPva(res.data);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const createBaseline = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await programmeIntelligenceApi.createBaseline(projectId);
      setBaselineId(res.data.snapshotId);
      await loadSnapshots();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const topVariances = pva?.activityVariances
    .filter((v) => (v.durationVarianceDays ?? 0) > 0 || (v.finishVarianceDays ?? 0) > 0)
    .slice(0, 5);

  return (
    <div className="border-t border-slate-300 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <span className="flex items-center gap-2">
          <History className="h-3.5 w-3.5" />
          Project history
          {snapshots.length > 0 && (
            <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] dark:bg-slate-700">
              {snapshots.length} snapshots
            </span>
          )}
        </span>
        {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>

      {open && (
        <div className="space-y-3 border-t border-slate-200 bg-white px-3 py-3 text-xs dark:border-slate-700 dark:bg-slate-900">
          {error && (
            <p className="text-red-600 dark:text-red-400">{error}</p>
          )}

          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void createBaseline()} disabled={loading}>
                Save baseline snapshot
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => void runComparison()}
              disabled={loading || !baselineId}
            >
              <TrendingUp className="mr-1 h-3 w-3" />
              Compare to live
            </Button>
          </div>

          {snapshots.length > 0 && (
            <div>
              <label className="text-slate-500">Baseline snapshot</label>
              <select
                value={baselineId}
                onChange={(e) => setBaselineId(e.target.value)}
                className="mt-1 block w-full max-w-md rounded border border-slate-200 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-800"
              >
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    v{s.snapshotVersion} · {s.sourceType}
                    {s.label ? ` · ${s.label}` : ""} · {new Date(s.importedAt).toLocaleDateString()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {pva && (
            <div className="rounded border border-amber-200 bg-amber-50/80 p-2 dark:border-amber-900/50 dark:bg-amber-950/30">
              <p className="font-medium text-amber-900 dark:text-amber-200">Planned vs actual (vs live)</p>
              <ul className="mt-1 space-y-0.5 text-amber-800 dark:text-amber-300/90">
                <li>{pva.projectSummary.activitiesWithDurationVariance} activities with duration variance</li>
                <li>{pva.projectSummary.activitiesWithFloatErosion} with float erosion</li>
                <li>{pva.projectSummary.criticalPathInstability} newly critical</li>
              </ul>
              {topVariances && topVariances.length > 0 && (
                <ul className="mt-2 list-inside list-disc text-[11px]">
                  {topVariances.map((v) => (
                    <li key={v.activityCode}>
                      {v.activityCode}
                      {v.durationVarianceDays != null && v.durationVarianceDays > 0
                        ? ` +${v.durationVarianceDays}d duration`
                        : ""}
                      {v.finishVarianceDays != null && v.finishVarianceDays > 0
                        ? ` +${v.finishVarianceDays}d finish`
                        : ""}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {snapshots.length === 0 && (
            <p className="text-slate-500">
              No snapshots yet. Import a live or as-built schedule from Import, or save a baseline here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
