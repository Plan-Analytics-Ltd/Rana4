"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronsDownUp, ChevronsUpDown, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProject } from "@/contexts/project-context";
import { api, getApiErrorMessage, rateCardApi, type RateCardEntry } from "@/lib/api";
import { FragnetNode } from "@/components/project/FragnetNode";
import { parseFullData, type ProjectFullData } from "@/lib/schedule-types";
import { rollupCosts } from "@/lib/schedule-metrics";
import { validateProjectSchedule, readinessScore } from "@/lib/schedule-validation";
import { ValidationPanel } from "@/components/schedule/validation-panel";
import { ReadinessDisplay } from "@/components/schedule/readiness-display";
import { CostSummaryCards } from "@/components/schedule/cost-summary-cards";
import { ProjectHealthBar } from "@/components/intelligence/project-health-bar";
import { useDeliverableIntelligenceCache } from "@/lib/use-deliverable-intelligence-cache";
import { useIntelligenceDrawer } from "@/contexts/intelligence-drawer-context";
import { cn } from "@/lib/utils";

const COLLAPSE_KEY = "rana4-viewer-collapse";

type CollapseState = {
  fragnets: Record<string, boolean>;
  deliverables: Record<string, boolean>;
};

function loadCollapse(projectId: string): CollapseState {
  if (typeof window === "undefined") return { fragnets: {}, deliverables: {} };
  try {
    const raw = localStorage.getItem(`${COLLAPSE_KEY}:${projectId}`);
    return raw ? JSON.parse(raw) : { fragnets: {}, deliverables: {} };
  } catch {
    return { fragnets: {}, deliverables: {} };
  }
}

function saveCollapse(projectId: string, state: CollapseState) {
  try {
    localStorage.setItem(`${COLLAPSE_KEY}:${projectId}`, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

export default function ProjectViewerPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const projectId = selectedProjectId;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ProjectFullData | null>(null);
  const [rateCard, setRateCard] = useState<RateCardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<"best" | "likely">("best");
  const [search, setSearch] = useState("");
  const [collapse, setCollapse] = useState<CollapseState>({ fragnets: {}, deliverables: {} });
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) setCollapse(loadCollapse(projectId));
  }, [projectId]);

  const persistCollapse = useCallback(
    (next: CollapseState) => {
      setCollapse(next);
      if (projectId) saveCollapse(projectId, next);
    },
    [projectId]
  );

  const loadProjectData = useCallback(
    async (opts?: { silent?: boolean }) => {
      setError(null);
      if (!projectId) {
        setData(null);
        return;
      }
      const silent = opts?.silent === true;
      try {
        if (!silent) {
          setLoading(true);
          setData(null);
        }
        const [res, rc] = await Promise.all([
          api.get<ProjectFullData>(`/projects/${encodeURIComponent(projectId)}/full-data`),
          rateCardApi.get().catch(() => ({ data: { entries: [] as RateCardEntry[] } })),
        ]);
        setData(parseFullData(res.data));
        setRateCard(rc.data.entries ?? []);
      } catch (err) {
        setError(getApiErrorMessage(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void loadProjectData();
  }, [loadProjectData]);

  const validationIssues = useMemo(
    () => (data ? validateProjectSchedule(data, rateCard, scenario) : []),
    [data, rateCard, scenario]
  );

  const readiness = useMemo(() => readinessScore(validationIssues), [validationIssues]);

  const costRollup = useMemo(() => {
    if (!data) return null;
    return rollupCosts(data, rateCard, scenario);
  }, [data, rateCard, scenario]);

  const projectDeliverableIds = useMemo(() => {
    if (!data) return [];
    return data.fragnets.flatMap((f) => f.deliverables.map((d) => d.id));
  }, [data]);

  const { snapshots: deliverableIntelById } = useDeliverableIntelligenceCache(
    projectId,
    projectDeliverableIds
  );
  const { openInsight } = useIntelligenceDrawer();

  const expandAll = () => {
    if (!data) return;
    const fragnets: Record<string, boolean> = {};
    const deliverables: Record<string, boolean> = {};
    for (const f of data.fragnets) {
      fragnets[f.id] = true;
      for (const d of f.deliverables) deliverables[d.id] = true;
    }
    persistCollapse({ fragnets, deliverables });
  };

  const collapseAll = () => {
    if (!data) return;
    const fragnets: Record<string, boolean> = {};
    const deliverables: Record<string, boolean> = {};
    for (const f of data.fragnets) {
      fragnets[f.id] = false;
      for (const d of f.deliverables) deliverables[d.id] = false;
    }
    persistCollapse({ fragnets, deliverables });
  };

  const onIssueClick = (entityId?: string) => {
    if (entityId) setHighlightId(entityId);
  };

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Project schedule</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            {selectedProject?.name ?? "Select a project"} — read-only hierarchy with costs and validation
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-slate-600 dark:text-slate-400">Duration scenario</label>
          <select
            value={scenario}
            onChange={(e) => setScenario(e.target.value as "best" | "likely")}
            className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          >
            <option value="best">Best</option>
            <option value="likely">Likely</option>
          </select>
        </div>
      </div>

      <ProjectHealthBar projectId={projectId} />

      {costRollup && <CostSummaryCards project={costRollup.project} byFragnet={[...costRollup.byFragnet.entries()].map(([id, r]) => ({ id, name: r.name, rollup: r }))} />}

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 overflow-hidden p-4 sm:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative max-w-md flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search activities, deliverables, codes…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={expandAll} disabled={!data}>
                <ChevronsDownUp className="h-4 w-4" /> Expand all
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={collapseAll} disabled={!data}>
                <ChevronsUpDown className="h-4 w-4" /> Collapse all
              </Button>
            </div>
          </div>

          {loading && <div className="text-sm text-slate-600 dark:text-slate-400">Loading schedule…</div>}
          {!loading && !projectId && <div className="text-sm text-slate-600">Select a project first.</div>}
          {!loading && error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {!loading && !error && data && data.fragnets.length === 0 && (
            <div className="text-sm text-slate-600">No schedule data. Import a template to get started.</div>
          )}
          {!loading && !error && data && data.fragnets.length > 0 && (
            <div className="space-y-4">
              {data.fragnets.map((f) => (
                <FragnetNode
                  key={f.id}
                  fragnet={f}
                  open={collapse.fragnets[f.id] ?? true}
                  onToggle={() =>
                    persistCollapse({
                      ...collapse,
                      fragnets: { ...collapse.fragnets, [f.id]: !(collapse.fragnets[f.id] ?? true) },
                    })
                  }
                  deliverableOpen={collapse.deliverables}
                  onDeliverableToggle={(id) =>
                    persistCollapse({
                      ...collapse,
                      deliverables: { ...collapse.deliverables, [id]: !(collapse.deliverables[id] ?? true) },
                    })
                  }
                  scenario={scenario}
                  rateCard={rateCard}
                  searchQuery={search}
                  highlightActivityId={highlightId}
                  deliverableIntelById={deliverableIntelById}
                  onDeliverableIntelClick={(deliverableId, deliverableName) => {
                    if (!projectId) return;
                    openInsight({ projectId, deliverableId, deliverableName });
                  }}
                />
              ))}
            </div>
          )}
        </Card>

        <Card className="flex min-h-0 min-w-0 flex-col overflow-hidden p-4 sm:p-5 lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
          <ReadinessDisplay readiness={readiness} className="mb-4 shrink-0" />
          <ValidationPanel
            className="min-h-0 flex-1"
            issues={validationIssues}
            title="Schedule validation"
            emptyMessage="Structurally ready — no critical or warning issues."
            onIssueClick={(i) => onIssueClick(i.entityId)}
          />
        </Card>
      </div>
    </div>
  );
}
