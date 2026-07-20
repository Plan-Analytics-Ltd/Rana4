"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Upload } from "lucide-react";
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
} from "@/lib/api";

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
  const { selectedProjectId } = useProject();
  const projectId = selectedProjectId;

  const [file, setFile] = useState<File | null>(null);
  const [programmeFile, setProgrammeFile] = useState<File | null>(null);
  const [programmeRole, setProgrammeRole] = useState<"LIVE_IMPORT" | "AS_BUILT">("AS_BUILT");
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportSuccessResponse | null>(null);
  const [programmeResult, setProgrammeResult] = useState<ProgrammeImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const canSubmit = useMemo(() => !!file && !!projectId && !loading, [file, projectId, loading]);
  const canProgrammeImport = useMemo(
    () => !!programmeFile && !!projectId && !loading,
    [programmeFile, projectId, loading]
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
    setSuccessMessage(null);
    if (!projectId || !programmeFile) return;
    try {
      setLoading(true);
      const res = await programmeIntelligenceApi.importProgramme(projectId, programmeFile, {
        snapshotRole: programmeRole,
      });
      setProgrammeResult(res.data);
      setSuccessMessage("Programme imported successfully.");
    } catch (err) {
      setError(asErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const uploadAndImport = async () => {
    setError(null);
    setResult(null);
    setSuccessMessage(null);
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
          setSuccessMessage("Project data imported successfully.");
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
          Import data
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">
          Import data into the selected project. To create a project from a Primavera P6 XER file, use{" "}
          <Link href="/app/projects/new" className="font-medium text-violet-700 underline dark:text-violet-300">
            New project
          </Link>.
        </p>
      </div>

      {successMessage ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
          {successMessage}
        </div>
      ) : null}

      <Card className="p-5">
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
              Import a schedule update or completed programme (XER or Rana4 JSON).
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
                  <option value="LIVE_IMPORT">Programme update</option>
                  <option value="AS_BUILT">Completed project</option>
                </select>
              </label>
              <Button onClick={uploadProgrammeImport} disabled={!canProgrammeImport}>
                {loading ? "Importing…" : "Import programme"}
              </Button>
            </div>
            {programmeResult ? (
              <div className="mt-4 rounded-md border border-cyan-200 bg-cyan-50 p-3 text-sm text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-200">
                <p className="font-semibold">Import saved</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app">View dashboard</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/app/deliverables">Review deliverables</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>
      </Card>

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

    </div>
  );
}
