"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useProject } from "@/contexts/project-context";
import { api, getApiErrorMessage, isAxiosError } from "@/lib/api";

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
    const data = err.response?.data as any;
    if (data && typeof data === "object" && typeof data.error === "string") return data.error;
  }
  return getApiErrorMessage(err);
}

export default function ImportPage() {
  const { selectedProjectId, selectedProject } = useProject();
  const projectId = selectedProjectId;

  const [file, setFile] = useState<File | null>(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ImportSuccessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => !!file && !!projectId && !loading, [file, projectId, loading]);

  const downloadTemplate = async () => {
    setError(null);
    setResult(null);
    try {
      setLoading(true);
      const res = await api.get<Blob>("/import/template", { responseType: "blob" as any });
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

  const uploadAndImport = async () => {
    setError(null);
    setResult(null);
    if (!projectId) {
      setError("Project not selected");
      return;
    }
    if (!file) {
      setError("No file selected");
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

      const data = res.data as any;
      if (data && typeof data === "object" && data.success === true) {
        setResult(data as ImportSuccessResponse);
        return;
      }
      if (data && typeof data === "object" && typeof data.error === "string") {
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
    <div className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Import</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Project: <span className="font-medium">{selectedProject?.name ?? "—"}</span>
        </p>
      </div>

      <Card className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">Template</h2>
            <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
              Download the latest Hybrid Import Excel template.
            </p>
          </div>
          <Button onClick={downloadTemplate} disabled={loading} className="shrink-0">
            {loading ? "Loading…" : "Download Template"}
          </Button>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-base font-semibold text-slate-900 dark:text-white">Upload</h2>
        <div className="mt-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Excel file (.xlsx)</label>
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
          </div>

          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={dryRun}
              onChange={(e) => setDryRun(e.target.checked)}
              disabled={loading}
            />
            Dry Run (validate only, no data saved)
          </label>

          <div className="flex items-center gap-3">
            <Button onClick={uploadAndImport} disabled={!canSubmit}>
              {loading ? "Uploading…" : "Upload & Import"}
            </Button>
            {!projectId && <span className="text-sm text-slate-500">Select a project first.</span>}
            {!file && projectId && <span className="text-sm text-slate-500">Choose an .xlsx file to continue.</span>}
          </div>
        </div>
      </Card>

      {(error || result) && (
        <Card className="p-5">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">Result</h2>

          {error && (
            <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200">
              <div className="font-semibold">Import Failed</div>
              <div className="mt-1 whitespace-pre-wrap">{error}</div>
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200">
              <div className="font-semibold">Import Successful</div>
              {"created" in result ? (
                <div className="mt-2 space-y-1">
                  <div>Standards: {result.created.standards}</div>
                  <div>Fragnets: {result.created.fragnets}</div>
                  <div>Deliverables: {result.created.deliverables}</div>
                  <div>Activities: {result.created.activities}</div>
                  <div>Relationships: {result.created.relationships}</div>
                  <div>Assignments: {result.assignmentsApplied}</div>
                </div>
              ) : (
                <div className="mt-2 space-y-1">
                  <div>Standards: {result.counts.standards}</div>
                  <div>Fragnets: {result.counts.fragnets}</div>
                  <div>Deliverables: {result.counts.deliverables}</div>
                  <div>Activities: {result.counts.activities}</div>
                  <div>Relationships: {result.counts.relationships}</div>
                  <div>Assignments: {result.counts.assignments}</div>
                </div>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

