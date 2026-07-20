"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GanttChart } from "@/components/schedule/gantt/gantt-chart";
import {
  ScheduleGrid,
  type ScheduleActivityPatch,
} from "@/components/schedule/workspace/schedule-grid";
import { ScheduleWorkspaceLayout } from "@/components/schedule/workspace/schedule-workspace-layout";
import { useProject } from "@/contexts/project-context";
import {
  activitiesApi,
  api,
  getApiErrorMessage,
  projectsApi,
  rateCardApi,
  type RateCardEntry,
  type ScheduleDiagnostic,
  type ScheduleNetworkActivity,
  type DeliverableActivityRelationship,
  type ActivityToDeliverableRelationship,
  type DeliverableRelationship,
  type ScheduleNetworkRelationship,
} from "@/lib/api";
import { buildScheduleViewRelationships } from "@/lib/schedule-view-relationships";
import { hasPermission } from "@/lib/project-permissions";
import { parseFullData, type ProjectFullData } from "@/lib/schedule-types";
import type { TimelineZoom } from "@/lib/schedule-timeline";
import { ScheduleRelationshipEditor } from "@/components/schedule/workspace/schedule-relationship-editor";
import {
  activityCodeToIdMap,
  buildDiagnosticsByActivity,
  buildWorkspaceRows,
  countCanonicalActivities,
  cpmActivityMap,
  projectStructuralIssues,
  relationshipHealthIssues,
  type WorkspaceRow,
} from "@/lib/schedule-workspace-data";

const COLLAPSE_KEY = "rana4-schedule-collapse";

type CollapseState = {
  fragnets: Record<string, boolean>;
  deliverables: Record<string, boolean>;
  sharedGroups: Record<string, boolean>;
  sharedActivities: Record<string, boolean>;
};

function loadCollapse(projectId: string): CollapseState {
  if (typeof window === "undefined") {
    return { fragnets: {}, deliverables: {}, sharedGroups: {}, sharedActivities: {} };
  }
  try {
    const raw = localStorage.getItem(`${COLLAPSE_KEY}:${projectId}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      fragnets: parsed?.fragnets ?? {},
      deliverables: parsed?.deliverables ?? {},
      sharedGroups: parsed?.sharedGroups ?? {},
      sharedActivities: parsed?.sharedActivities ?? {},
    };
  } catch {
    return { fragnets: {}, deliverables: {}, sharedGroups: {}, sharedActivities: {} };
  }
}

function saveCollapse(projectId: string, state: CollapseState) {
  try {
    localStorage.setItem(`${COLLAPSE_KEY}:${projectId}`, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export default function SchedulePage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading schedule…
        </div>
      }
    >
      <ScheduleWorkspacePage />
    </Suspense>
  );
}

function ScheduleWorkspacePage() {
  const { selectedProjectId, selectedProject, selectedProjectRole } = useProject();
  const mayEdit = hasPermission(selectedProjectRole, "activity", "update");

  const [loading, setLoading] = useState(false);
  const [fullData, setFullData] = useState<ProjectFullData | null>(null);
  const [activityRelationships, setActivityRelationships] = useState<ScheduleNetworkRelationship[]>([]);
  const [deliverableRelationships, setDeliverableRelationships] = useState<DeliverableRelationship[]>([]);
  const [deliverableActivityRelationships, setDeliverableActivityRelationships] = useState<
    DeliverableActivityRelationship[]
  >([]);
  const [activityToDeliverableRelationships, setActivityToDeliverableRelationships] = useState<
    ActivityToDeliverableRelationship[]
  >([]);
  const [cpmActivities, setCpmActivities] = useState<Map<string, ScheduleNetworkActivity>>(new Map());
  const [projectScheduleStart, setProjectScheduleStart] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<ScheduleDiagnostic[]>([]);
  const [criticalIds, setCriticalIds] = useState<Set<string>>(new Set());
  const [rateCard, setRateCard] = useState<RateCardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<"best" | "likely">("best");
  const [zoom, setZoom] = useState<TimelineZoom>("weeks");
  const [search, setSearch] = useState("");
  const [collapse, setCollapse] = useState<CollapseState>({
    fragnets: {},
    deliverables: {},
    sharedGroups: {},
    sharedActivities: {},
  });
  const [scrollTop, setScrollTop] = useState(0);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [logicPredNodeId, setLogicPredNodeId] = useState("");
  const [logicSuccNodeId, setLogicSuccNodeId] = useState("");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [savingCanonicalId, setSavingCanonicalId] = useState<string | null>(null);

  const applyScheduleNetwork = useCallback((network: Awaited<ReturnType<typeof projectsApi.getScheduleNetwork>>["data"]) => {
    setActivityRelationships(network.relationships ?? []);
    setDeliverableRelationships(network.deliverableRelationships ?? []);
    setDeliverableActivityRelationships(network.deliverableActivityRelationships ?? []);
    setActivityToDeliverableRelationships(network.activityToDeliverableRelationships ?? []);
    setCpmActivities(cpmActivityMap(network.activities ?? []));
    setProjectScheduleStart(network.projectStart ?? null);
    setDiagnostics(network.diagnostics ?? []);
  }, []);

  const reloadScheduleMetrics = useCallback(async () => {
    if (!selectedProjectId) return;
    const [network, critical] = await Promise.all([
      projectsApi.getScheduleNetwork(selectedProjectId),
      projectsApi.getCriticalPath(selectedProjectId),
    ]);
    applyScheduleNetwork(network.data);
    setCriticalIds(new Set(critical.data.activities.map((a) => a.id)));
  }, [applyScheduleNetwork, selectedProjectId]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!selectedProjectId) return;
    setError(null);
    const silent = opts?.silent === true;
    try {
      if (!silent) setLoading(true);
      const [tree, network, critical, rc] = await Promise.all([
        api.get<ProjectFullData>(`/projects/${encodeURIComponent(selectedProjectId)}/full-data`),
        projectsApi.getScheduleNetwork(selectedProjectId),
        projectsApi.getCriticalPath(selectedProjectId),
        rateCardApi.get().catch(() => ({ data: { entries: [] as RateCardEntry[] } })),
      ]);
      setFullData(parseFullData(tree.data));
      applyScheduleNetwork(network.data);
      setCriticalIds(new Set(critical.data.activities.map((a) => a.id)));
      setRateCard(rc.data.entries ?? []);
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [applyScheduleNetwork, selectedProjectId]);

  useEffect(() => {
    if (selectedProjectId) setCollapse(loadCollapse(selectedProjectId));
  }, [selectedProjectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const persistCollapse = useCallback(
    (next: CollapseState) => {
      setCollapse(next);
      if (selectedProjectId) saveCollapse(selectedProjectId, next);
    },
    [selectedProjectId]
  );

  const rows: WorkspaceRow[] = useMemo(() => {
    if (!fullData) return [];
    return buildWorkspaceRows(
      fullData,
      collapse,
      cpmActivities,
      deliverableRelationships,
      scenario,
      search,
      projectScheduleStart
    );
  }, [fullData, collapse, cpmActivities, deliverableRelationships, scenario, search, projectScheduleStart]);

  const viewRelationships = useMemo(
    () =>
      buildScheduleViewRelationships(
        activityRelationships,
        deliverableRelationships,
        deliverableActivityRelationships,
        activityToDeliverableRelationships
      ),
    [
      activityRelationships,
      deliverableRelationships,
      deliverableActivityRelationships,
      activityToDeliverableRelationships,
    ]
  );

  const [logicFragnetId, setLogicFragnetId] = useState<string | null>(null);
  const scheduleFragnetId = useMemo(() => {
    if (!fullData?.fragnets.length) return null;
    if (logicFragnetId && fullData.fragnets.some((f) => f.id === logicFragnetId)) return logicFragnetId;
    return fullData.fragnets[0]!.id;
  }, [fullData, logicFragnetId]);

  useEffect(() => {
    if (!fullData?.fragnets.length) {
      setLogicFragnetId(null);
      return;
    }
    if (!logicFragnetId || !fullData.fragnets.some((f) => f.id === logicFragnetId)) {
      setLogicFragnetId(fullData.fragnets[0]!.id);
    }
  }, [fullData, logicFragnetId]);

  const diagnosticsByActivity = useMemo(() => {
    if (!fullData) return new Map();
    const structural = projectStructuralIssues(fullData, rateCard, scenario);
    const health = relationshipHealthIssues(fullData, activityRelationships);
    const codeToId = activityCodeToIdMap(fullData);
    return buildDiagnosticsByActivity([...structural, ...health, ...diagnostics], codeToId);
  }, [fullData, rateCard, scenario, activityRelationships, diagnostics]);

  const criticalSet = useMemo(() => {
    const s = new Set(criticalIds);
    for (const row of rows) {
      if (row.kind !== "activity" || !row.activityId) continue;
      if (row.cpm?.isCritical) s.add(row.activityId);
    }
    return s;
  }, [criticalIds, rows]);

  const saveActivity = useCallback(
    async (canonicalId: string, patch: ScheduleActivityPatch) => {
      if (!mayEdit) return;
      setSavingCanonicalId(canonicalId);
      try {
        await activitiesApi.update(canonicalId, patch);
        await reloadScheduleMetrics();
        toast.success("Activity saved");
      } catch (err) {
        toast.error(getApiErrorMessage(err));
      } finally {
        setSavingCanonicalId(null);
      }
    },
    [mayEdit, reloadScheduleMetrics]
  );

  const expandAll = () => {
    if (!fullData) return;
    const fragnets: Record<string, boolean> = {};
    const deliverables: Record<string, boolean> = {};
    const sharedGroups: Record<string, boolean> = {};
    const sharedActivities: Record<string, boolean> = {};
    for (const f of fullData.fragnets) {
      fragnets[f.id] = true;
      sharedGroups[f.id] = true;
      for (const d of f.deliverables) deliverables[d.id] = true;
      for (const a of f.sharedActivities ?? []) sharedActivities[a.id] = true;
    }
    persistCollapse({ fragnets, deliverables, sharedGroups, sharedActivities });
  };

  const collapseAll = () => {
    if (!fullData) return;
    const fragnets: Record<string, boolean> = {};
    const deliverables: Record<string, boolean> = {};
    const sharedGroups: Record<string, boolean> = {};
    const sharedActivities: Record<string, boolean> = {};
    for (const f of fullData.fragnets) {
      fragnets[f.id] = false;
      sharedGroups[f.id] = false;
      for (const d of f.deliverables) deliverables[d.id] = false;
      for (const a of f.sharedActivities ?? []) sharedActivities[a.id] = false;
    }
    persistCollapse({ fragnets, deliverables, sharedGroups, sharedActivities });
  };

  const activityCount = useMemo(
    () => (fullData ? countCanonicalActivities(fullData) : 0),
    [fullData]
  );

  const critCount = criticalSet.size;

  const logicClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (logicClickTimerRef.current) clearTimeout(logicClickTimerRef.current);
    };
  }, []);

  const handleNodeClick = useCallback((nodeId: string | null, fragnetId: string) => {
    if (!nodeId) return;
    if (logicClickTimerRef.current) clearTimeout(logicClickTimerRef.current);
    logicClickTimerRef.current = setTimeout(() => {
      logicClickTimerRef.current = null;
      setSelectedNodeId(nodeId);
      setLogicPredNodeId(nodeId);
      setLogicFragnetId(fragnetId);
    }, 280);
  }, []);

  const handleNodeDoubleClick = useCallback((nodeId: string | null, fragnetId: string) => {
    if (!nodeId) return;
    if (logicClickTimerRef.current) {
      clearTimeout(logicClickTimerRef.current);
      logicClickTimerRef.current = null;
    }
    setSelectedNodeId(nodeId);
    setLogicFragnetId(fragnetId);
    setLogicSuccNodeId(nodeId);
  }, []);

  return (
    <div>
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold tracking-tight text-slate-900 dark:text-white">
            Schedule workspace
          </h1>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">
            {selectedProject?.name ?? "Select a project"} · {activityCount} activities · {critCount} critical
            {mayEdit
              ? " · click = predecessor · double-click = successor · double-click cell to edit"
              : " · click = predecessor · double-click = successor"}
          </p>
        </div>
        <div className="relative w-48 max-w-full">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter…"
            className="h-8 pl-8 text-xs"
          />
        </div>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
          Duration
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as "best" | "likely")}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="best">Best</option>
            <option value="likely">Likely</option>
          </select>
        </label>
        <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-400">
          Zoom
          <select
            value={zoom}
            onChange={(e) => setZoom(e.target.value as TimelineZoom)}
            className="h-8 rounded border border-slate-200 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="days">Days</option>
            <option value="weeks">Weeks</option>
            <option value="months">Months</option>
          </select>
        </label>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={expandAll} disabled={!fullData}>
          <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> Expand
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={collapseAll} disabled={!fullData}>
          <ChevronsUpDown className="mr-1 h-3.5 w-3.5" /> Collapse
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={cnIcon(loading)} /> Refresh
        </Button>
      </header>

      {!selectedProjectId && (
        <div className="flex items-center justify-center py-16 text-sm text-slate-500">
          Select a project to open the schedule workspace.
        </div>
      )}
      {error && (
        <div className="mx-3 mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}
      {selectedProjectId && !error && (
        <div className="relative flex min-w-0 flex-col overflow-hidden">
          {loading && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-white/60 text-sm dark:bg-slate-950/60">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading schedule…
            </div>
          )}
          <div className="relative h-[min(900px,calc(100vh-10rem))] min-h-[720px] min-w-0 overflow-hidden">
          <ScheduleWorkspaceLayout defaultLeftPercent={65}
            left={
              <ScheduleGrid
                rows={rows}
                collapse={collapse}
                diagnosticsByActivity={diagnosticsByActivity}
                selectedNodeId={selectedNodeId}
                logicPredNodeId={logicPredNodeId}
                logicSuccNodeId={logicSuccNodeId}
                hoveredNodeId={hoveredNodeId}
                scrollTop={scrollTop}
                canEdit={mayEdit}
                scenario={scenario}
                savingCanonicalId={savingCanonicalId}
                onSaveActivity={saveActivity}
                onScrollTop={setScrollTop}
                onSelect={handleNodeClick}
                onSelectSuccessor={handleNodeDoubleClick}
                onHover={setHoveredNodeId}
                onToggleFragnet={(id) =>
                  persistCollapse({
                    ...collapse,
                    fragnets: { ...collapse.fragnets, [id]: !(collapse.fragnets[id] ?? true) },
                  })
                }
                onToggleDeliverable={(id) =>
                  persistCollapse({
                    ...collapse,
                    deliverables: { ...collapse.deliverables, [id]: !(collapse.deliverables[id] ?? true) },
                  })
                }
                onToggleSharedGroup={(fragnetId) =>
                  persistCollapse({
                    ...collapse,
                    sharedGroups: {
                      ...collapse.sharedGroups,
                      [fragnetId]: !(collapse.sharedGroups[fragnetId] ?? true),
                    },
                  })
                }
                onToggleSharedActivity={(activityId) =>
                  persistCollapse({
                    ...collapse,
                    sharedActivities: {
                      ...collapse.sharedActivities,
                      [activityId]: !(collapse.sharedActivities[activityId] ?? true),
                    },
                  })
                }
              />
            }
            right={
              <GanttChart
                rows={rows}
                relationships={viewRelationships}
                criticalActivityIds={criticalSet}
                zoom={zoom}
                scrollTop={scrollTop}
                scrollLeft={scrollLeft}
                selectedActivityId={selectedNodeId}
                hoveredActivityId={hoveredNodeId}
                onScroll={(top, left) => {
                  setScrollTop(top);
                  setScrollLeft(left);
                }}
              />
            }
          />
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            {fullData && fullData.fragnets.length > 1 ? (
              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                Fragnet
                <select
                  value={scheduleFragnetId ?? ""}
                  onChange={(e) => setLogicFragnetId(e.target.value)}
                  className="h-8 rounded border border-slate-200 bg-white px-2 text-xs dark:border-slate-600 dark:bg-slate-800"
                >
                  {fullData.fragnets.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <ScheduleRelationshipEditor
              className="min-w-0 flex-1"
              rows={rows}
              relationships={viewRelationships}
              projectId={selectedProjectId}
              fragnetId={scheduleFragnetId}
              predecessorId={logicPredNodeId}
              onPredecessorIdChange={setLogicPredNodeId}
              successorId={logicSuccNodeId}
              onSuccessorIdChange={setLogicSuccNodeId}
              canEdit={mayEdit}
              onCreated={() => void load()}
            />
          </div>
        </div>
      )}

    </div>
    </div>
  );
}

function cnIcon(spin: boolean) {
  return spin ? "mr-1 h-3.5 w-3.5 animate-spin" : "mr-1 h-3.5 w-3.5";
}
