"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileUp,
  FolderPlus,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AnalysisSummaryCard,
  DetectedFieldRow,
  DetectedSummaryGrid,
  DetailedAnalysisPanel,
  DeveloperModeToggle,
  OnboardingStatusHero,
  ProgrammeStatisticsGrid,
  RequiresAttentionSection,
} from "@/components/projects/programme-detection-panel";
import { getApiErrorMessage, projectsApi, type ProjectDetectionResult, type XerProjectPreview } from "@/lib/api";
import { useProject } from "@/contexts/project-context";

type Mode = "choose" | "blank" | "xer-upload" | "xer-preview" | "xer-details" | "xer-success";

function applyDetection(detection: ProjectDetectionResult | null) {
  return {
    projectName: detection?.projectName.value ?? "",
    clientType: detection?.clientType.value ?? "",
    projectType: detection?.projectType.value ?? "",
    stage: detection?.stage.value ?? "",
    complexity: detection?.complexity.value ?? "",
  };
}

export default function NewProjectPage() {
  const router = useRouter();
  const { refreshProjects, setSelectedProjectId } = useProject();

  const [mode, setMode] = useState<Mode>("choose");
  const [blankName, setBlankName] = useState("");
  const [blankSaving, setBlankSaving] = useState(false);

  const [xerFile, setXerFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<XerProjectPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [clientType, setClientType] = useState("");
  const [projectType, setProjectType] = useState("");
  const [stage, setStage] = useState("");
  const [complexity, setComplexity] = useState("");
  const [description, setDescription] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ projectId: string; projectName: string } | null>(null);

  const [editingField, setEditingField] = useState<string | null>(null);
  const [developerMode, setDeveloperMode] = useState(false);

  const runPreview = useCallback(async (file: File) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const { data } = await projectsApi.previewFromXer(file);
      setPreview(data);
      if (data.valid) {
        const detected = applyDetection(data.detection);
        setProjectName(detected.projectName || data.suggestedProjectName);
        setClientType(detected.clientType);
        setProjectType(detected.projectType);
        setStage(detected.stage);
        setComplexity(detected.complexity);
        setEditingField(null);
        setMode("xer-preview");
      } else {
        toast.error(data.errors[0]?.message ?? "This XER file could not be read.");
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to preview XER file");
    } finally {
      setPreviewLoading(false);
    }
  }, []);

  const handleXerFile = (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".xer")) {
      toast.error("Please choose a Primavera .xer file.");
      return;
    }
    setXerFile(file);
    void runPreview(file);
  };

  const createBlank = async () => {
    const name = blankName.trim();
    if (!name) {
      toast.error("Enter a project name.");
      return;
    }
    setBlankSaving(true);
    try {
      const { data } = await projectsApi.create({ name });
      await refreshProjects();
      setSelectedProjectId(data.id);
      toast.success("Project created.");
      router.push("/app/schedule");
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to create project");
    } finally {
      setBlankSaving(false);
    }
  };

  const importXer = async () => {
    if (!xerFile) return;
    const name = projectName.trim();
    if (!name) {
      toast.error("Enter a project name.");
      return;
    }
    setImporting(true);
    try {
      const { data } = await projectsApi.createFromXer(xerFile, {
        name,
        clientType: clientType.trim() || undefined,
        projectType: projectType.trim() || undefined,
        stage: stage.trim() || undefined,
        complexity: complexity.trim() || undefined,
        description: description.trim() || undefined,
      });
      await refreshProjects();
      setSelectedProjectId(data.projectId);
      setImportResult({ projectId: data.projectId, projectName: data.projectName });
      toast.success("Your Primavera programme has been imported successfully.");
      setMode("xer-success");
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Import failed");
    } finally {
      setImporting(false);
    }
  };

  const detection = preview?.detection ?? null;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      <div>
        <Link
          href="/app"
          className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">New project</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Start from scratch or bring in an existing Primavera P6 programme.
        </p>
      </div>

      {mode === "choose" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Card
            className="cursor-pointer border-slate-200 transition hover:border-violet-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-violet-700"
            onClick={() => setMode("blank")}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FolderPlus className="h-5 w-5 text-slate-500" />
                Blank project
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600 dark:text-slate-400">
              Create an empty Rana4 project and build your programme manually or from the Excel template.
            </CardContent>
          </Card>

          <Card
            className="cursor-pointer border-violet-200/80 transition hover:border-violet-400 hover:shadow-sm dark:border-violet-900/50 dark:hover:border-violet-600"
            onClick={() => setMode("xer-upload")}
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <FileUp className="h-5 w-5 text-violet-600 dark:text-violet-400" />
                Import Primavera programme
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-slate-600 dark:text-slate-400">
              Upload a .xer export to create a live, editable project. This does not add historical learning — use
              Import Project History later for monthly revisions.
            </CardContent>
          </Card>
        </div>
      )}

      {mode === "blank" && (
        <Card>
          <CardHeader>
            <CardTitle>Blank project</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Project name</label>
              <Input
                className="mt-1"
                value={blankName}
                onChange={(e) => setBlankName(e.target.value)}
                placeholder="e.g. Riverside Hospital — Phase 2"
              />
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("choose")}>
                Back
              </Button>
              <Button type="button" onClick={() => void createBlank()} disabled={blankSaving}>
                {blankSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Create project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {mode === "xer-upload" && (
        <Card>
          <CardHeader>
            <CardTitle>Step 1 — Upload XER</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Export your current programme from Primavera P6 as a .xer file.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-600">
              <Upload className="mb-2 h-8 w-8 text-slate-400" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {xerFile ? xerFile.name : "Choose a .xer file"}
              </span>
              <input
                type="file"
                accept=".xer"
                className="hidden"
                onChange={(e) => handleXerFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {previewLoading ? (
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Analysing programme…
              </div>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setMode("choose")}>
              Back
            </Button>
          </CardContent>
        </Card>
      )}

      {mode === "xer-preview" && preview?.valid && detection && (
        <div className="space-y-10">
          <OnboardingStatusHero
            detection={detection}
            projectTitle={detection.projectName.value || preview.suggestedProjectName}
            primaveraProjectName={preview.projectName || null}
          />

          <DetectedSummaryGrid detection={detection} />

          <RequiresAttentionSection detection={detection} />

          <ProgrammeStatisticsGrid preview={preview} />

          <AnalysisSummaryCard preview={preview} detection={detection} />

          <DetailedAnalysisPanel
            detection={detection}
            preview={preview}
            developerMode={developerMode}
            onDeveloperModeChange={setDeveloperMode}
          />

          {preview.errors.length > 0 ? (
            <IssueList title="Errors" items={preview.errors} variant="error" />
          ) : null}
          {preview.warnings.length > 0 ? (
            <IssueList title="Warnings" items={preview.warnings} variant="warning" />
          ) : null}

          <div className="flex gap-3 border-t border-slate-100 pt-6 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setMode("xer-upload")}>
              Back
            </Button>
            <Button type="button" onClick={() => setMode("xer-details")} disabled={preview.errors.length > 0}>
              Continue to Project Details <ArrowRight className="ml-1 h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {mode === "xer-details" && (
        <div className="space-y-6">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Project details</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Confirm or edit what Rana4 detected before creating your project.
            </p>
          </div>

          {detection && preview ? (
            <RequiresAttentionSection detection={detection} />
          ) : null}

          <div className="rounded-xl bg-slate-50/80 px-5 py-2 dark:bg-slate-900/40">
            <div className="mb-2 flex justify-end">
              <DeveloperModeToggle enabled={developerMode} onChange={setDeveloperMode} />
            </div>
            <DetectedFieldRow
              label="Project name"
              value={projectName}
              field={detection?.projectName ?? null}
              editing={editingField === "projectName"}
              onEdit={() => setEditingField("projectName")}
              onChange={setProjectName}
              required
              developerMode={developerMode}
              detection={detection}
              preview={preview}
            />
            <DetectedFieldRow
              label="Project type"
              value={projectType}
              field={detection?.projectType ?? null}
              editing={editingField === "projectType"}
              onEdit={() => setEditingField("projectType")}
              onChange={setProjectType}
              placeholder="e.g. Healthcare"
              developerMode={developerMode}
              detection={detection}
              preview={preview}
            />
            <DetectedFieldRow
              label="Client"
              value={clientType}
              field={detection?.clientType ?? null}
              editing={editingField === "clientType"}
              onEdit={() => setEditingField("clientType")}
              onChange={setClientType}
              placeholder="e.g. NHS Trust"
              developerMode={developerMode}
              detection={detection}
              preview={preview}
            />
            <DetectedFieldRow
              label="Stage"
              value={stage}
              field={detection?.stage ?? null}
              editing={editingField === "stage"}
              onEdit={() => setEditingField("stage")}
              onChange={setStage}
              placeholder="e.g. Construction"
              developerMode={developerMode}
              detection={detection}
              preview={preview}
            />
            <DetectedFieldRow
              label="Complexity"
              value={complexity}
              field={detection?.complexity ?? null}
              editing={editingField === "complexity"}
              onEdit={() => setEditingField("complexity")}
              onChange={setComplexity}
              placeholder="e.g. Medium"
              developerMode={developerMode}
              detection={detection}
              preview={preview}
            />
            <div className="border-t border-slate-100 py-4 dark:border-slate-800">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Description</label>
              <textarea
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional notes about this project"
              />
            </div>
          </div>

          <div className="flex gap-3 border-t border-slate-100 pt-6 dark:border-slate-800">
            <Button type="button" variant="outline" onClick={() => setMode("xer-preview")}>
              Back
            </Button>
            <Button type="button" onClick={() => void importXer()} disabled={importing}>
              {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Create Project &amp; Import Programme
            </Button>
          </div>
        </div>
      )}

      {mode === "xer-success" && importResult && (
        <Card className="border-emerald-200 dark:border-emerald-900/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-800 dark:text-emerald-200">
              <CheckCircle2 className="h-6 w-6" />
              Import complete
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
              Your Primavera programme has been imported successfully into{" "}
              <strong>{importResult.projectName}</strong>. Rana is now learning from it. You can open the schedule, or
              import completed projects so Rana can compare this work with previous projects.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => router.push("/app/schedule")}>
                Open schedule
              </Button>
              <Button type="button" variant="outline" onClick={() => router.push("/app/import")}>
                Import project history
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function IssueList({
  title,
  items,
  variant,
}: {
  title: string;
  items: { message: string }[];
  variant: "error" | "warning";
}) {
  const cls =
    variant === "error"
      ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200"
      : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200";
  return (
    <div className={`rounded-md border px-3 py-2 text-sm ${cls}`}>
      <div className="font-medium">{title}</div>
      <ul className="mt-1 list-inside list-disc space-y-0.5">
        {items.map((item, i) => (
          <li key={i}>{item.message}</li>
        ))}
      </ul>
    </div>
  );
}
