"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  standardsApi,
  fragnetsApi,
  deliverablesApi,
  exportApi,
  type Standard,
  type Fragnet,
  type Deliverable,
  getApiErrorMessage,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProject } from "@/contexts/project-context";

type Scenario = "best" | "likely";
type ExportMode = "FRAGNET" | "STANDARD";

export default function ExportPage() {
  const { selectedProjectId } = useProject();
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState<string>("");
  const [fragnets, setFragnets] = useState<Fragnet[]>([]);
  const [selectedFragnetId, setSelectedFragnetId] = useState<string>("");
  const [mode, setMode] = useState<ExportMode>("FRAGNET");
  const [scenario, setScenario] = useState<Scenario>("best");
  const [projectId, setProjectId] = useState<string>("");
  const [projectName, setProjectName] = useState<string>("");
  const [unassignedDeliverables, setUnassignedDeliverables] = useState<Deliverable[]>([]);
  const [includedUnassignedIds, setIncludedUnassignedIds] = useState<Record<string, boolean>>({});
  const [loadingStandards, setLoadingStandards] = useState(true);
  const [loadingFragnets, setLoadingFragnets] = useState(false);
  const [exporting, setExporting] = useState(false);

  const fetchStandards = async () => {
    setLoadingStandards(true);
    try {
      if (!selectedProjectId) {
        setStandards([]);
        setSelectedStandardId("");
        return;
      }
      const { data } = await standardsApi.list(selectedProjectId);
      setStandards(data);
      if (data.length > 0 && !selectedStandardId) setSelectedStandardId(data[0].id);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load standards");
    } finally {
      setLoadingStandards(false);
    }
  };

  const fetchFragnets = async () => {
    if (!selectedStandardId) {
      setFragnets([]);
      setSelectedFragnetId("");
      return;
    }
    setLoadingFragnets(true);
    try {
      const { data } = await fragnetsApi.listByStandard(selectedStandardId);
      setFragnets(data);
      setSelectedFragnetId(data.length > 0 ? data[0].id : "");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load fragnets");
      setFragnets([]);
      setSelectedFragnetId("");
    } finally {
      setLoadingFragnets(false);
    }
  };

  const fetchUnassignedDeliverables = async () => {
    try {
      if (!selectedProjectId) {
        setUnassignedDeliverables([]);
        return;
      }
      const { data } = await deliverablesApi.list(selectedProjectId);
      const unassigned = data.filter((d) => d.fragnetId == null);
      setUnassignedDeliverables(unassigned);
      setIncludedUnassignedIds((prev) => {
        const next = { ...prev };
        unassigned.forEach((d) => {
          if (next[d.id] === undefined) next[d.id] = false;
        });
        return next;
      });
    } catch {
      setUnassignedDeliverables([]);
    }
  };

  const toggleUnassigned = (id: string, checked: boolean) => {
    setIncludedUnassignedIds((prev) => ({ ...prev, [id]: checked }));
  };

  useEffect(() => {
    fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    fetchFragnets();
  }, [selectedStandardId]);

  useEffect(() => {
    fetchUnassignedDeliverables();
  }, [selectedProjectId]);

  const handleExport = async () => {
    if (mode === "FRAGNET" && !selectedFragnetId) {
      toast.error("Select a fragnet first");
      return;
    }
    if (mode === "STANDARD" && !selectedStandardId) {
      toast.error("Select a standard first");
      return;
    }
    const pid = projectId.trim();
    const pname = projectName.trim();
    if (!pid) {
      toast.error("Project ID is required");
      return;
    }
    if (!pname) {
      toast.error("Project Name is required");
      return;
    }
    setExporting(true);
    try {
      const unassignedIds = unassignedDeliverables
        .filter((d) => includedUnassignedIds[d.id])
        .map((d) => d.id);
      const response =
        mode === "FRAGNET"
          ? await exportApi.fragnet(selectedFragnetId, {
              scenario,
              projectName: pname,
              projectId: pid,
              ...(unassignedIds.length > 0 && { unassignedDeliverableIds: unassignedIds }),
            })
          : await exportApi.standard(selectedStandardId, {
              scenario,
              projectName: pname,
              projectId: pid,
            });
      const data = response.data;
      const headersAny = response.headers as unknown as { get?: (k: string) => string | null } & Record<string, unknown>;
      const contentDisposition =
        (typeof headersAny?.get === "function" ? headersAny.get("content-disposition") : null) ??
        (headersAny?.["content-disposition"] as string | undefined);
      let filename = "project_export.zip";
      if (contentDisposition) {
        const match = contentDisposition.match(/filename="?([^"]+)"?/i);
        if (match?.[1]) filename = match[1];
      }

      const url = URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Export downloaded (TASK, TASKPRED, TASKRSRC; RSRC sheet if rate card is uploaded)");
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to export");
    } finally {
      setExporting(false);
    }
  };

  const selectedStandard = standards.find((s) => s.id === selectedStandardId);
  const selectedFragnet = fragnets.find((f) => f.id === selectedFragnetId);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Export</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Export fragnets as a single Excel file (TASK, TASKPRED, TASKRSRC; RSRC resource definitions when a rate card exists).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select standard and fragnet</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Choose a standard, fragnet, scenario (best or likely), and P6 Project ID / Project Name, then download.
            </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {loadingStandards ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading standards…
            </div>
          ) : standards.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No standards yet. Create one on the Standards page first.</p>
          ) : (
            <>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Export mode</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as ExportMode)}
                  className={cn(
                    "flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  )}
                >
                  <option value="FRAGNET">Export Fragnet</option>
                  <option value="STANDARD">Export Full Standard</option>
                </select>
                {mode === "STANDARD" && (
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Full standard export may create large schedules.
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Standard</label>
                <select
                  value={selectedStandardId}
                  onChange={(e) => setSelectedStandardId(e.target.value)}
                  className={cn(
                    "flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  )}
                >
                  {standards.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Fragnet</label>
                <select
                  value={selectedFragnetId}
                  onChange={(e) => setSelectedFragnetId(e.target.value)}
                  disabled={mode === "STANDARD" || !selectedStandardId || loadingFragnets || fragnets.length === 0}
                  className={cn(
                    "flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50"
                  )}
                >
                  {fragnets.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                  {fragnets.length === 0 && <option value="">No fragnets</option>}
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Scenario</label>
                <select
                  value={scenario}
                  onChange={(e) => setScenario(e.target.value as Scenario)}
                  className={cn(
                    "flex h-9 max-w-xs rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  )}
                >
                  <option value="best">Best duration</option>
                  <option value="likely">Likely duration</option>
                </select>
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Project ID (P6)</label>
                <input
                  type="text"
                  value={projectId}
                  onChange={(e) => setProjectId(e.target.value)}
                  placeholder="e.g. RANA4-001"
                  className={cn(
                    "flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  )}
                />
              </div>
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Project Name (P6)</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g. Rana4 Export"
                  className={cn(
                    "flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                  )}
                />
              </div>
              {unassignedDeliverables.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Include unassigned deliverables (no fragnet) — choose one by one:
                  </p>
                  <ul className="space-y-1.5 rounded-md border border-slate-200 bg-slate-50/50 py-2 pl-4 pr-3 dark:border-slate-700 dark:bg-slate-900/30">
                    {unassignedDeliverables.map((d) => (
                      <li key={d.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`unassigned-${d.id}`}
                          checked={includedUnassignedIds[d.id] ?? false}
                          onChange={(e) => toggleUnassigned(d.id, e.target.checked)}
                          className="h-4 w-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-400"
                        />
                        <label
                          htmlFor={`unassigned-${d.id}`}
                          className="cursor-pointer text-sm text-slate-700 dark:text-slate-300"
                        >
                          {d.name}
                          <span className="ml-1.5 text-slate-500 dark:text-slate-400">
                            (Best: {d.bestDuration}, Likely: {d.likelyDuration})
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button
                onClick={handleExport}
                disabled={
                  (mode === "FRAGNET" && (!selectedFragnetId || fragnets.length === 0)) ||
                  !projectId.trim() ||
                  !projectName.trim() ||
                  exporting
                }
              >
                {exporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {exporting ? "Exporting…" : "Download Excel"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {mode === "FRAGNET" && selectedFragnetId && selectedFragnet && (
        <Card>
          <CardHeader>
            <CardTitle>Export summary</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Fragnet &quot;{selectedFragnet.name}&quot; under {selectedStandard?.name} — scenario: {scenario}. Project ID: {projectId || "—"}, Project Name: {projectName || "—"}. File: fragnet-{projectId || "…"}-{scenario}.xlsx: TASK, TASKPRED, RSRC (from rate card if uploaded), TASKRSRC (assignments).
              {unassignedDeliverables.filter((d) => includedUnassignedIds[d.id]).length > 0 && (
                <> Including {unassignedDeliverables.filter((d) => includedUnassignedIds[d.id]).length} unassigned deliverable(s) in the export.</>
              )}
            </p>
          </CardHeader>
        </Card>
      )}

      {mode === "STANDARD" && selectedStandard && (
        <Card>
          <CardHeader>
            <CardTitle>Export summary</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Full standard export for &quot;{selectedStandard.name}&quot; — scenario: {scenario}. Project ID: {projectId || "—"}, Project Name: {projectName || "—"}.
            </p>
          </CardHeader>
        </Card>
      )}
    </div>
  );
}
