"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Loader2, Download, History, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  standardsApi,
  fragnetsApi,
  exportApi,
  api,
  rateCardApi,
  type Standard,
  type Fragnet,
  type RateCardEntry,
  type ExportPreflightIssue,
  getApiErrorMessage,
  getApiErrorMessageAsync,
  assertBlobIsZipDownload,
} from "@/lib/api";
import type { ValidationIssue } from "@/lib/schedule-validation";
import { cn } from "@/lib/utils";
import { useProject } from "@/contexts/project-context";
import { parseFullData, type ProjectFullData } from "@/lib/schedule-types";
import { validateProjectSchedule, readinessScore } from "@/lib/schedule-validation";
import { ValidationPanel } from "@/components/schedule/validation-panel";
import { ReadinessDisplay } from "@/components/schedule/readiness-display";
import { appendExportHistory, loadExportHistory, type ExportHistoryEntry } from "@/lib/export-history";
import { filterUserVisibleFragnets, filterUserVisibleStandards } from "@/lib/project-level-ui";

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
  const [preflightIssues, setPreflightIssues] = useState<ExportPreflightIssue[]>([]);
  const [preflightSummary, setPreflightSummary] = useState<string>("");
  const [loadingPreflight, setLoadingPreflight] = useState(false);
  const [loadingStandards, setLoadingStandards] = useState(true);
  const [loadingFragnets, setLoadingFragnets] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [fullData, setFullData] = useState<ProjectFullData | null>(null);
  const [rateCard, setRateCard] = useState<RateCardEntry[]>([]);
  const [loadingHealth, setLoadingHealth] = useState(false);
  const [history, setHistory] = useState<ExportHistoryEntry[]>([]);
  const [forceExport, setForceExport] = useState(false);

  const refreshHistory = useCallback(() => {
    if (selectedProjectId) setHistory(loadExportHistory(selectedProjectId));
  }, [selectedProjectId]);

  const fetchStandards = async () => {
    setLoadingStandards(true);
    try {
      if (!selectedProjectId) {
        setStandards([]);
        setSelectedStandardId("");
        return;
      }
      const { data } = await standardsApi.list(selectedProjectId);
      const visibleStandards = filterUserVisibleStandards(data);
      setStandards(visibleStandards);
      setSelectedStandardId((prev) =>
        prev && visibleStandards.some((standard) => standard.id === prev) ? prev : (visibleStandards[0]?.id ?? "")
      );
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
      const visibleFragnets = filterUserVisibleFragnets(data);
      setFragnets(visibleFragnets);
      setSelectedFragnetId((prev) =>
        prev && visibleFragnets.some((fragnet) => fragnet.id === prev) ? prev : (visibleFragnets[0]?.id ?? "")
      );
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load fragnets");
      setFragnets([]);
      setSelectedFragnetId("");
    } finally {
      setLoadingFragnets(false);
    }
  };

  const fetchHealth = async () => {
    if (!selectedProjectId) {
      setFullData(null);
      return;
    }
    setLoadingHealth(true);
    try {
      const [res, rc] = await Promise.all([
        api.get<ProjectFullData>(`/projects/${encodeURIComponent(selectedProjectId)}/full-data`),
        rateCardApi.get().catch(() => ({ data: { entries: [] as RateCardEntry[] } })),
      ]);
      setFullData(parseFullData(res.data));
      setRateCard(rc.data.entries ?? []);
    } catch {
      setFullData(null);
      setRateCard([]);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    fetchFragnets();
  }, [selectedStandardId]);

  useEffect(() => {
    fetchHealth();
    refreshHistory();
  }, [selectedProjectId, refreshHistory]);

  const healthIssues = useMemo(
    () => (fullData ? validateProjectSchedule(fullData, rateCard, scenario) : []),
    [fullData, rateCard, scenario]
  );

  const readiness = useMemo(() => readinessScore(healthIssues), [healthIssues]);

  const preflightValidationIssues = useMemo((): ValidationIssue[] => {
    return preflightIssues.map((issue, idx) => ({
      id: `preflight-${idx}-${issue.code}`,
      severity: issue.severity === "warning" ? "warning" : "critical",
      code: issue.code,
      message: `[${issue.phase}] ${issue.message}`,
      entityType: issue.fragnetId ? "fragnet" : undefined,
      entityId: issue.fragnetId,
    }));
  }, [preflightIssues]);

  const combinedHealthIssues = useMemo(
    () => [...healthIssues, ...preflightValidationIssues],
    [healthIssues, preflightValidationIssues]
  );

  const combinedReadiness = useMemo(() => readinessScore(combinedHealthIssues), [combinedHealthIssues]);

  const canRunPreflight =
    projectId.trim() !== "" &&
    projectName.trim() !== "" &&
    ((mode === "STANDARD" && selectedStandardId) || (mode === "FRAGNET" && selectedFragnetId));

  const runExportPreflight = useCallback(async () => {
    if (!canRunPreflight) {
      setPreflightIssues([]);
      setPreflightSummary("");
      return;
    }
    setLoadingPreflight(true);
    try {
      const body = {
        scenario,
        projectId: projectId.trim(),
        projectName: projectName.trim(),
      };
      const { data } =
        mode === "STANDARD"
          ? await exportApi.preflightStandard(selectedStandardId, body)
          : await exportApi.preflightFragnet(selectedFragnetId, body);
      setPreflightIssues(data.issues ?? []);
      const assign = data.assignment;
      const assignLine = assign
        ? `Activities: ${assign.activityCount}. Orphans: ${assign.orphanActivities.length}. Unknown deliverables: ${assign.unknownDeliverableActivities.length}. Cross-fragnet: ${assign.crossFragnetMismatches.length}.`
        : "";
      setPreflightSummary(
        data.ok
          ? assignLine
            ? `Export pipeline OK. ${assignLine}`
            : "Export pipeline OK — no blocking issues found."
          : `${data.errorCount} blocking issue(s)${data.warningCount ? `, ${data.warningCount} warning(s)` : ""}. ${assignLine}`.trim()
      );
    } catch (err: unknown) {
      setPreflightIssues([]);
      setPreflightSummary(getApiErrorMessage(err) || "Preflight check failed");
    } finally {
      setLoadingPreflight(false);
    }
  }, [
    canRunPreflight,
    mode,
    selectedStandardId,
    selectedFragnetId,
    scenario,
    projectId,
    projectName,
  ]);

  useEffect(() => {
    if (!canRunPreflight) {
      setPreflightIssues([]);
      setPreflightSummary("");
      return;
    }
    const t = window.setTimeout(() => {
      void runExportPreflight();
    }, 600);
    return () => window.clearTimeout(t);
  }, [canRunPreflight, runExportPreflight]);

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
    if (!selectedProjectId) {
      toast.error("Select a workspace project first");
      return;
    }
    if (combinedReadiness.critical > 0 && !forceExport) {
      toast.error("Resolve critical validation issues or enable export anyway");
      return;
    }

    const targetName =
      mode === "FRAGNET"
        ? fragnets.find((f) => f.id === selectedFragnetId)?.name ?? "Fragnet"
        : standards.find((s) => s.id === selectedStandardId)?.name ?? "Standard";

    const started = performance.now();
    const entryId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    setExporting(true);
    try {
      const response =
        mode === "FRAGNET"
          ? await exportApi.fragnet(selectedFragnetId, {
              scenario,
              projectName: pname,
              projectId: pid,
            })
          : await exportApi.standard(selectedStandardId, {
              scenario,
              projectName: pname,
              projectId: pid,
            });
      const data = await assertBlobIsZipDownload(response);
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

      appendExportHistory({
        id: entryId,
        at: new Date().toISOString(),
        ranaProjectId: selectedProjectId,
        mode,
        targetName,
        scenario,
        p6ProjectId: pid,
        p6ProjectName: pname,
        status: "success",
        durationMs: Math.round(performance.now() - started),
        filename,
        validationErrors: combinedReadiness.critical,
        validationWarnings: combinedReadiness.warning,
      });
      refreshHistory();
      toast.success("Export downloaded (ZIP: Excel + XER)");
    } catch (err: unknown) {
      const msg = (await getApiErrorMessageAsync(err)) || "Failed to export";
      toast.error(msg);
      appendExportHistory({
        id: entryId,
        at: new Date().toISOString(),
        ranaProjectId: selectedProjectId,
        mode,
        targetName,
        scenario,
        p6ProjectId: pid,
        p6ProjectName: pname,
        status: "failure",
        durationMs: Math.round(performance.now() - started),
        error: msg,
        validationErrors: combinedReadiness.critical,
        validationWarnings: combinedReadiness.warning,
      });
      refreshHistory();
    } finally {
      setExporting(false);
    }
  };

  const selectedStandard = standards.find((s) => s.id === selectedStandardId);
  const selectedFragnet = fragnets.find((f) => f.id === selectedFragnetId);

  const exportDisabled =
    (mode === "FRAGNET" && (!selectedFragnetId || fragnets.length === 0)) ||
    !projectId.trim() ||
    !projectName.trim() ||
    exporting ||
    (combinedReadiness.critical > 0 && !forceExport) ||
    loadingPreflight;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Export Center</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Schedule health plus a full export dry-run (WBS, Excel, XER validation) — issues appear here before you download. Downloads are Excel + P6 XER in a ZIP.
        </p>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                Schedule readiness
              </CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Readiness score from schedule validation before you generate exports.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingHealth || loadingPreflight ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {loadingPreflight ? "Running export dry-run…" : "Analyzing project…"}
                </div>
              ) : !selectedProjectId ? (
                <p className="text-sm text-slate-500">Select a project from the header to run health checks.</p>
              ) : (
                <>
                  <ReadinessDisplay readiness={combinedReadiness} />
                  <p className="text-sm text-slate-500">
                    Scenario: {scenario === "best" ? "Best duration" : "Likely duration"}
                  </p>
                  {preflightSummary && (
                    <p
                      className={cn(
                        "text-sm",
                        preflightIssues.length > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-700 dark:text-emerald-300"
                      )}
                    >
                      {preflightSummary}
                    </p>
                  )}
                  {combinedReadiness.critical > 0 && (
                    <label className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900/50 dark:bg-amber-950/20">
                      <input
                        type="checkbox"
                        checked={forceExport}
                        onChange={(e) => setForceExport(e.target.checked)}
                        className="mt-1 h-4 w-4"
                      />
                      <span>
                        <AlertTriangle className="mb-1 inline h-4 w-4 text-amber-600" /> Export anyway despite critical
                        issues (not recommended).
                      </span>
                    </label>
                  )}
                  <ValidationPanel
                    className="min-h-0"
                    issues={combinedHealthIssues}
                    title="Pre-export validation"
                    emptyMessage={
                      canRunPreflight
                        ? "Schedule and export pipeline look ready."
                        : "Enter P6 project ID and name to run the full export dry-run."
                    }
                  />
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Generate export</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Choose standard, fragnet (for fragnet mode), scenario, and P6 project identifiers.
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
                  </div>

                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Standard</label>
                    <select
                      value={selectedStandardId}
                      onChange={(e) => setSelectedStandardId(e.target.value)}
                      className="flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      {standards.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Fragnet</label>
                    <select
                      value={selectedFragnetId}
                      onChange={(e) => setSelectedFragnetId(e.target.value)}
                      disabled={mode === "STANDARD" || loadingFragnets}
                      className="flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800"
                    >
                      {fragnets.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Scenario</label>
                    <select
                      value={scenario}
                      onChange={(e) => setScenario(e.target.value as Scenario)}
                      className="flex h-9 max-w-xs rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                    >
                      <option value="best">Best duration</option>
                      <option value="likely">Likely duration</option>
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">P6 Project ID</label>
                    <input
                      type="text"
                      value={projectId}
                      onChange={(e) => setProjectId(e.target.value)}
                      placeholder="e.g. RANA4-001"
                      className="flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">P6 Project Name</label>
                    <input
                      type="text"
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder="e.g. Rana4 Export"
                      className="flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void runExportPreflight()}
                      disabled={!canRunPreflight || loadingPreflight}
                    >
                      {loadingPreflight ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="h-4 w-4" />
                      )}
                      {loadingPreflight ? "Checking…" : "Re-run export check"}
                    </Button>
                    <Button onClick={handleExport} disabled={exportDisabled}>
                      {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                      {exporting ? "Exporting…" : "Download ZIP (XLSX + XER)"}
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="min-w-0 overflow-hidden lg:sticky lg:top-4 lg:max-h-[calc(100vh-6rem)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4" />
              Export history
            </CardTitle>
          </CardHeader>
          <CardContent>
            {history.length === 0 ? (
              <p className="text-sm text-slate-500">No exports recorded for this project yet.</p>
            ) : (
              <ul className="max-h-[480px] space-y-3 overflow-y-auto text-sm">
                {history.map((h) => (
                  <li
                    key={h.id}
                    className={cn(
                      "rounded-md border px-3 py-2",
                      h.status === "success"
                        ? "border-slate-200 dark:border-slate-700"
                        : "border-red-200 bg-red-50/50 dark:border-red-900/40 dark:bg-red-950/20"
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <span className="font-medium text-slate-900 dark:text-white">{h.targetName}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                          h.status === "success"
                            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
                            : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"
                        )}
                      >
                        {h.status}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(h.at).toLocaleString()} · {h.mode} · {h.scenario}
                    </p>
                    <p className="text-xs text-slate-500">
                      ZIP (xlsx + xer)
                      {h.durationMs != null ? ` · ${(h.durationMs / 1000).toFixed(1)}s` : ""}
                    </p>
                    {(h.validationErrors != null || h.validationWarnings != null) && (
                      <p className="text-xs text-slate-500">
                        Val: {h.validationErrors ?? 0} err / {h.validationWarnings ?? 0} warn
                      </p>
                    )}
                    {h.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{h.error}</p>}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      disabled={exporting}
                      onClick={() => {
                        setMode(h.mode);
                        setScenario(h.scenario);
                        setProjectId(h.p6ProjectId);
                        setProjectName(h.p6ProjectName);
                        toast.message("Settings restored — click Download to regenerate");
                      }}
                    >
                      Use settings
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {mode === "FRAGNET" && selectedFragnet && (
        <p className="text-sm text-slate-500">
          Next export: fragnet &quot;{selectedFragnet.name}&quot; under {selectedStandard?.name ?? "—"}.
        </p>
      )}
    </div>
  );
}
