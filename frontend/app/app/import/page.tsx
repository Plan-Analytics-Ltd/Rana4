"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Loader2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProject } from "@/contexts/project-context";
import {
  api,
  getApiErrorMessage,
  isAxiosError,
  programmeIntelligenceApi,
  type ProgrammeImportResult,
  type ProgrammeSnapshotSummary,
} from "@/lib/api";
import { IntelligenceSection } from "@/components/intelligence/intelligence-section";
import { IntelligenceEmptyState } from "@/components/intelligence/intelligence-empty-state";
import { RecentActivityCard } from "@/components/intelligence/dashboard/recent-activity-card";
import { humanSnapshotRole, humanSourceType, snapshotKnowledgeBadges } from "@/lib/intelligence-terminology";
import { Badge } from "@/components/ui/badge";
import { snapshotStoryFallbackLabel } from "@/lib/planner-language";

type ImportSuccessResponse =
  | {
      success: true;
      created: {
        standards: number;
        fragnets: number;
        deliverables: number;
        activities: number;
        relationships: number;
      };
      assignmentsApplied: number;
    }
  | {
      success: true;
      counts: {
        standards: number;
        fragnets: number;
        deliverables: number;
        activities: number;
        relationships: number;
        assignments: number;
      };
    };

type ImportErrorResponse = { error: string };

function asErrorMessage(err: unknown): string {
  if (isAxiosError(err)) {
    const data = err.response?.data as { error?: string };
    if (data && typeof data === "object" && typeof data.error === "string") return data.error;
  }
  return getApiErrorMessage(err);
}

export default function ImportPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const projectId = selectedProjectId;

  const [file, setFile] = useState<File | null>(null);
  const [programmeFile, setProgrammeFile] = useState<File | null>(null);
  const [programmeRole, setProgrammeRole] = useState<"LIVE_IMPORT" | "AS_BUILT">("AS_BUILT");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [result, setResult] = useState<ImportSuccessResponse | null>(null);
  const [programmeResult, setProgrammeResult] = useState<ProgrammeImportResult | null>(null);
  const [snapshots, setSnapshots] = useState<ProgrammeSnapshotSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [knowledgeMessage, setKnowledgeMessage] = useState<string | null>(null);

  const loadLibrary = useCallback(async () => {
    if (!projectId) {
      setLibraryLoading(false);
      return;
    }
    setLibraryLoading(true);
    try {
      const snapRes = await programmeIntelligenceApi.listSnapshots(projectId);
      setSnapshots(snapRes.data.snapshots ?? []);
    } catch {
      setSnapshots([]);
    } finally {
      setLibraryLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void loadLibrary();
  }, [loadLibrary]);

  const canSubmit = useMemo(() => !!file && !!projectId && !loading, [file, projectId, loading]);
  const canProgrammeImport = useMemo(
    () => !!programmeFile && !!projectId && !loading,
    [programmeFile, projectId, loading]
  );

  const recentSnapshots = useMemo(
    () => [...snapshots].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime()).slice(0, 5),
    [snapshots]
  );

  const downloadTemplate = async () => {
    setError(null);
    setResult(null);
    try {
      setLoading(true);
      const res = await api.get<Blob>("/import/template", { responseType: "blob" as never });
      const blob = new Blob([res.data], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "import-template.xlsx";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const uploadProgrammeImport = async () => {
    setError(null);
    setProgrammeResult(null);
    setKnowledgeMessage(null);
    if (!projectId || !programmeFile) return;
    try {
      setLoading(true);
      const res = await programmeIntelligenceApi.importProgramme(projectId, programmeFile, {
        snapshotRole: programmeRole,
      });
      setProgrammeResult(res.data);
      setKnowledgeMessage(
        programmeRole === "AS_BUILT"
          ? "Programme imported successfully. Rana is now learning from it."
          : "Update imported successfully. It has been added to this project’s evolution timeline."
      );
      await loadLibrary();
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const uploadAndImport = async () => {
    setError(null);
    setResult(null);
    setKnowledgeMessage(null);
    if (!projectId || !file) {
      setError(projectId ? "No file selected" : "Project not selected");
      return;
    }

    try {
      setLoading(true);
      const formData = new FormData();
      formData.append("file", file);

      const res = await api.post<ImportSuccessResponse | ImportErrorResponse>(
        `/projects/${encodeURIComponent(projectId)}/import?dryRun=${dryRun ? "true" : "false"}`,
        formData
      );

      const data = res.data as ImportSuccessResponse | ImportErrorResponse;
      if (data && typeof data === "object" && "success" in data && data.success === true) {
        setResult(data as ImportSuccessResponse);
        if (!dryRun) {
          setKnowledgeMessage("Project data imported successfully. Rana is now learning from it.");
          await loadLibrary();
        }
        return;
      }
      if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
        setError(data.error);
        return;
      }
      setError("Import failed");
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
          <Upload className="h-7 w-7 text-violet-600 dark:text-violet-400" />
          Import history
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          There are two different reasons to import data:
          (1) <span className="font-medium">Compared with Previous Projects</span> (learning from completed projects),
          and (2) <span className="font-medium">Project Evolution</span> (tracking how this project changes over time).
          This is separate from creating a new project from Primavera — use{" "}
          <Link href="/app/projects/new" className="font-medium text-violet-700 underline dark:text-violet-300">
            New project
          </Link>{" "}
          for your first baseline import.
        </p>
      </div>

      {libraryLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading this project’s import history…
        </div>
      ) : null}

      {knowledgeMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {knowledgeMessage}
        </div>
      ) : null}

      <IntelligenceSection
        title="Import data"
        description="Import completed projects to strengthen comparisons, or import updates to build the project’s evolution timeline."
      >
        <div className="space-y-6">
          <Card className="border-slate-200 p-5 dark:border-slate-700">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Excel project data</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Import standards, fragnets, deliverables, and activities from the hybrid Excel template.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button onClick={downloadTemplate} disabled={loading} variant="outline" size="sm">
                Download template
              </Button>
            </div>
            <div className="mt-4 space-y-4">
              <Input
                type="file"
                accept=".xlsx"
                onChange={(e) => {
                  setError(null);
                  setResult(null);
                  setFile(e.target.files?.[0] ?? null);
                }}
                disabled={loading}
              />
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={dryRun}
                  onChange={(e) => setDryRun(e.target.checked)}
                  disabled={loading}
                />
                Validate only (no data saved)
              </label>
              <Button onClick={uploadAndImport} disabled={!canSubmit}>
                {loading ? "Uploading…" : dryRun ? "Validate import" : "Import project data"}
              </Button>
            </div>
          </Card>

          <Card className="border-slate-200 p-5 dark:border-slate-700">
            <h3 className="text-base font-semibold text-slate-900 dark:text-white">Programme schedule</h3>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Import a schedule (XER or Rana4 JSON). Use completed projects to strengthen comparisons with previous
              projects. Use programme updates over time to build the Project Evolution timeline for this project.
            </p>
            <div className="mt-4 space-y-4">
              <Input
                type="file"
                accept=".xer,.json,application/json"
                onChange={(e) => {
                  setError(null);
                  setProgrammeResult(null);
                  setProgrammeFile(e.target.files?.[0] ?? null);
                }}
                disabled={loading}
              />
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Import purpose
                <select
                  value={programmeRole}
                  onChange={(e) => setProgrammeRole(e.target.value as "LIVE_IMPORT" | "AS_BUILT")}
                  className="mt-1 block w-full max-w-xs rounded border border-slate-200 bg-white px-2 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-800"
                  disabled={loading}
                >
                  <option value="AS_BUILT">Compared with Previous Projects (completed project)</option>
                  <option value="LIVE_IMPORT">Project Evolution (programme update)</option>
                </select>
              </label>
              <Button onClick={uploadProgrammeImport} disabled={!canProgrammeImport}>
                {loading ? "Importing…" : "Import programme"}
              </Button>
            </div>
            {programmeResult ? (
              <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-200">
                <p className="font-semibold">Import saved</p>
                <p className="mt-1">
                  If this was a completed project, it strengthens comparisons with previous projects. If this was a
                  programme update, it adds a point on this project’s evolution timeline.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app">View dashboard</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app/deliverables">Review deliverables</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app/intelligence">What we&apos;ve learned</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </IntelligenceSection>

      {(error || result) && (
        <Card className="p-5">
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
          {result && !dryRun && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <p className="font-semibold">Project data imported successfully</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button asChild size="sm" variant="outline">
                  <Link href="/app">View dashboard</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/app/deliverables">Review deliverables</Link>
                </Button>
              </div>
            </div>
          )}
          {result && dryRun && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900/40">
              <p className="font-semibold">Validation passed — no data was saved</p>
            </div>
          )}
        </Card>
      )}

      <IntelligenceSection
        title="Project Evolution timeline"
        description={`Baseline and revision history stored for ${selectedProject?.name ?? "this project"}.`}
      >
        {recentSnapshots.length === 0 ? (
          <IntelligenceEmptyState
            icon={BookOpen}
            title="No Project Evolution timeline yet"
            description="Save a baseline and import programme updates over time. This creates the timeline used in Project Evolution."
          />
        ) : (
          <div className="space-y-4">
            {recentSnapshots.map((s) => (
              <div
                key={s.id}
                className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900/50"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">
                      <Link href="/app/schedule" className="hover:text-violet-700 dark:hover:text-violet-300">
                        {snapshotStoryFallbackLabel({
                          programmeDisplayName: s.programmeDisplayName,
                          label: s.label,
                          snapshotRole: s.snapshotRole,
                          snapshotVersion: s.snapshotVersion,
                        })}
                      </Link>
                    </p>
                    <p className="text-sm text-slate-500">
                      {humanSourceType(s.sourceType)} · {new Date(s.importedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <Badge variant="outline">{humanSnapshotRole(s.snapshotRole)}</Badge>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {snapshotKnowledgeBadges(s).map((b) => (
                    <Badge key={b} variant="secondary" className="text-[10px] font-normal">
                      {b}
                    </Badge>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </IntelligenceSection>

      {recentSnapshots.length > 0 ? (
        <IntelligenceSection title="Recent imports" description="Latest additions to this project’s timeline.">
          <div className="grid gap-3 sm:grid-cols-2">
            {recentSnapshots.map((s) => (
              <RecentActivityCard
                key={s.id}
                href="/app/schedule"
                title={snapshotStoryFallbackLabel({
                  programmeDisplayName: s.programmeDisplayName,
                  label: s.label,
                  snapshotRole: s.snapshotRole,
                  snapshotVersion: s.snapshotVersion,
                })}
                subtitle={`${humanSnapshotRole(s.snapshotRole)} · ${s.activityCount} activities`}
                date={new Date(s.importedAt).toLocaleDateString()}
              />
            ))}
          </div>
        </IntelligenceSection>
      ) : null}
    </div>
  );
}
