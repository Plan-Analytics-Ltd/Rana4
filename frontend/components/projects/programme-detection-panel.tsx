"use client";

import { useState, type ReactNode } from "react";
import {
  Activity,
  AlertCircle,
  Building2,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Gauge,
  GitBranch,
  Layers,
  Link2,
  Pencil,
  Sparkles,
  Users,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DetectedField, DetectionConfidence, ProjectDetectionResult, XerProjectPreview } from "@/lib/api";
import {
  alternativeConsidered,
  alternativeRejectionReason,
  buildAnalysisSummary,
  buildStatusSummarySentence,
  CLIENT_UNKNOWN_REASON,
  CLIENT_UNKNOWN_SOURCE,
  complexityHumanSummary,
  confidencePresentation,
  developerTraceLines,
  displaySummaryValue,
  displayValueForField,
  fieldOneLineExplanation,
  formatPreviewDate,
  humanDecisionSummary,
  manualReviewItems,
  NOT_IDENTIFIED_EXPLANATION,
  readinessHeadline,
  traceSourcesSummary,
} from "@/lib/project-detection-ui";

// ---------------------------------------------------------------------------
// Status hero (Section 1)
// ---------------------------------------------------------------------------

export function OnboardingStatusHero({
  detection,
  projectTitle,
  primaveraProjectName,
}: {
  detection: ProjectDetectionResult;
  projectTitle: string;
  primaveraProjectName: string | null;
}) {
  const headline = readinessHeadline(detection);
  const positive = detection.readiness.ready;

  return (
    <section className="space-y-4">
      <div
        className={`flex items-start gap-4 rounded-2xl px-6 py-6 ${
          positive
            ? "bg-emerald-50/80 dark:bg-emerald-950/20"
            : "bg-amber-50/80 dark:bg-amber-950/20"
        }`}
      >
        <div
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full ${
            positive
              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
              : "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300"
          }`}
        >
          {positive ? <CheckCircle2 className="h-6 w-6" /> : <AlertCircle className="h-6 w-6" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{headline}</p>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white sm:text-3xl">
            {projectTitle}
          </h2>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            {buildStatusSummarySentence(detection)}
          </p>
        </div>
      </div>

      {primaveraProjectName && primaveraProjectName !== projectTitle ? (
        <div className="px-1">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Original Primavera project
          </p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{primaveraProjectName}</p>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detected summary cards (Section 2)
// ---------------------------------------------------------------------------

type SummaryCardConfig = {
  key: string;
  label: string;
  icon: ReactNode;
  field: DetectedField;
};

function SubtleConfidence({ confidence, hasValue }: { confidence: DetectionConfidence; hasValue: boolean }) {
  if (!hasValue) {
    return (
      <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
        <span className="text-slate-600 dark:text-slate-300">Needs confirmation</span>
      </p>
    );
  }
  if (confidence === "none") return null;
  const { title, explanation } = confidencePresentation(confidence);
  return (
    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
      <span className="text-slate-600 dark:text-slate-300">{title}</span>
      <span className="mx-1">·</span>
      {explanation}
    </p>
  );
}

function DetectedSummaryCard({ label, icon, field }: { label: string; icon: ReactNode; field: DetectedField }) {
  const value = displaySummaryValue(field, label);
  const explanation = fieldOneLineExplanation(field, label);

  return (
    <div className="rounded-xl bg-slate-50/80 p-5 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-3 text-lg font-semibold text-slate-900 dark:text-white">{value}</p>
      {field.value ? (
        <SubtleConfidence confidence={field.confidence} hasValue={Boolean(field.value)} />
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">{explanation}</p>
      )}
    </div>
  );
}

export function DetectedSummaryGrid({ detection }: { detection: ProjectDetectionResult }) {
  const cards: SummaryCardConfig[] = [
    {
      key: "projectType",
      label: "Project type",
      icon: <Building2 className="h-4 w-4" />,
      field: detection.projectType,
    },
    {
      key: "stage",
      label: "Stage",
      icon: <Layers className="h-4 w-4" />,
      field: detection.stage,
    },
    {
      key: "complexity",
      label: "Complexity",
      icon: <Gauge className="h-4 w-4" />,
      field: detection.complexity,
    },
    {
      key: "client",
      label: "Client",
      icon: <Users className="h-4 w-4" />,
      field: detection.clientType,
    },
  ];

  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">What Rana4 detected</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((card) => (
          <DetectedSummaryCard key={card.key} label={card.label} icon={card.icon} field={card.field} />
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Requires attention (Section 5)
// ---------------------------------------------------------------------------

export function RequiresAttentionSection({ detection }: { detection: ProjectDetectionResult }) {
  const items = manualReviewItems(detection);
  if (items.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-amber-200/60 bg-amber-50/40 px-5 py-4 dark:border-amber-900/30 dark:bg-amber-950/15">
      <h3 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Requires your attention</h3>
      <div className="space-y-4">
        {items.map((item) => (
          <div key={item.field} className="space-y-1">
            <p className="text-sm font-medium text-slate-900 dark:text-white">{item.field}</p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Reason: </span>
              {item.reason}
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-700 dark:text-slate-300">Action: </span>
              {item.action}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Analysis summary (Section 6)
// ---------------------------------------------------------------------------

export function AnalysisSummaryCard({
  preview,
  detection,
}: {
  preview: XerProjectPreview;
  detection: ProjectDetectionResult;
}) {
  const lines = buildAnalysisSummary(preview, detection);

  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">How Rana4 analysed this programme</h3>
      <div className="rounded-xl bg-slate-50/80 px-5 py-4 dark:bg-slate-900/40">
        <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
          {lines.map((line) => (
            <li key={line.label} className="flex items-center gap-2">
              <CheckCircle2
                className={`h-3.5 w-3.5 shrink-0 ${line.complete ? "text-emerald-600 dark:text-emerald-400" : "text-slate-300 dark:text-slate-600"}`}
              />
              {line.label}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Programme statistics (Section 3)
// ---------------------------------------------------------------------------

function StatItem({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <div className="mt-0.5 text-slate-400 dark:text-slate-500">{icon}</div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
        <p className="text-sm font-medium text-slate-900 dark:text-white">{value}</p>
      </div>
    </div>
  );
}

export function ProgrammeStatisticsGrid({ preview }: { preview: XerProjectPreview }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">Programme summary</h3>
      <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        <StatItem icon={<Activity className="h-4 w-4" />} label="Activities" value={String(preview.activityCount)} />
        <StatItem
          icon={<Link2 className="h-4 w-4" />}
          label="Relationships"
          value={String(preview.relationshipCount)}
        />
        <StatItem icon={<GitBranch className="h-4 w-4" />} label="WBS" value={String(preview.wbsCount)} />
        <StatItem icon={<Calendar className="h-4 w-4" />} label="Calendars" value={String(preview.calendarCount)} />
        <StatItem
          icon={<Clock className="h-4 w-4" />}
          label="Project start"
          value={formatPreviewDate(preview.projectStart)}
        />
        <StatItem
          icon={<Clock className="h-4 w-4" />}
          label="Project finish"
          value={formatPreviewDate(preview.projectFinish)}
        />
        <StatItem icon={<Wrench className="h-4 w-4" />} label="Resources" value={String(preview.resourceCount)} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Detailed analysis (Section 7) — collapsed by default
// ---------------------------------------------------------------------------

function FieldAnalysisBlock({
  label,
  field,
  developerMode,
  detectionTimeMs,
  complexityLines,
}: {
  label: string;
  field: DetectedField | null;
  developerMode: boolean;
  detectionTimeMs?: number;
  complexityLines?: string[];
}) {
  if (!field) return null;

  const isClientUnknown = label.toLowerCase() === "client" && !field.value;
  const alternative = alternativeConsidered(field);
  const altReason = alternativeRejectionReason(field);

  return (
    <div className="space-y-2 border-t border-slate-200/80 pt-4 first:border-t-0 first:pt-0 dark:border-slate-700/80">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
      <div className="space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
        <p>
          <span className="font-medium text-slate-700 dark:text-slate-300">Decision: </span>
          {displayValueForField(field, label)}
        </p>
        <p>
          <span className="font-medium text-slate-700 dark:text-slate-300">Reason: </span>
          {isClientUnknown ? CLIENT_UNKNOWN_REASON : humanDecisionSummary(field)}
        </p>
        {field.confidence !== "none" && field.value ? (
          <p>
            <span className="font-medium text-slate-700 dark:text-slate-300">How sure: </span>
            {confidencePresentation(field.confidence).title} — {confidencePresentation(field.confidence).explanation}
          </p>
        ) : null}
        {alternative ? (
          <p>
            <span className="font-medium text-slate-700 dark:text-slate-300">Alternative considered: </span>
            {alternative}
            {altReason ? ` — ${altReason}` : ""}
          </p>
        ) : null}
        {complexityLines?.length ? (
          <div>
            <span className="font-medium text-slate-700 dark:text-slate-300">Based on:</span>
            <ul className="mt-1 list-inside list-disc">
              {complexityLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {traceSourcesSummary(field.trace) ? (
          <p>
            <span className="font-medium text-slate-700 dark:text-slate-300">Evidence: </span>
            {traceSourcesSummary(field.trace)}
          </p>
        ) : null}
        {developerMode ? (
          <pre className="overflow-x-auto rounded bg-slate-900/90 p-2 font-mono text-[10px] text-slate-200">
            {developerTraceLines(field, detectionTimeMs).join("\n") || "No technical trace."}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

export function DetailedAnalysisPanel({
  detection,
  preview,
  developerMode,
  onDeveloperModeChange,
}: {
  detection: ProjectDetectionResult;
  preview: XerProjectPreview;
  developerMode: boolean;
  onDeveloperModeChange: (v: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const complexityLines = complexityHumanSummary(detection, preview);

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-2 text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <Sparkles className="h-4 w-4" />
        {open ? "Hide detailed analysis" : "View detailed analysis"}
      </button>

      {open ? (
        <div className="mt-4 space-y-1 rounded-xl bg-slate-50/80 px-5 py-4 dark:bg-slate-900/40">
          <div className="mb-3 flex justify-end">
            <DeveloperModeToggle enabled={developerMode} onChange={onDeveloperModeChange} />
          </div>
          <FieldAnalysisBlock
            label="Project name"
            field={detection.projectName}
            developerMode={developerMode}
            detectionTimeMs={detection.detectionTimeMs}
          />
          <FieldAnalysisBlock
            label="Project type"
            field={detection.projectType}
            developerMode={developerMode}
            detectionTimeMs={detection.detectionTimeMs}
          />
          <FieldAnalysisBlock
            label="Stage"
            field={detection.stage}
            developerMode={developerMode}
            detectionTimeMs={detection.detectionTimeMs}
          />
          <FieldAnalysisBlock
            label="Complexity"
            field={detection.complexity}
            developerMode={developerMode}
            detectionTimeMs={detection.detectionTimeMs}
            complexityLines={complexityLines}
          />
          <FieldAnalysisBlock
            label="Client"
            field={detection.clientType}
            developerMode={developerMode}
            detectionTimeMs={detection.detectionTimeMs}
          />
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Developer mode toggle
// ---------------------------------------------------------------------------

export function DeveloperModeToggle({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="text-xs text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline dark:text-slate-400 dark:hover:text-slate-200"
    >
      {enabled ? "Hide developer diagnostics" : "Developer mode"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Details step field row (confirm/edit)
// ---------------------------------------------------------------------------

function FieldDecisionPanel({
  label,
  field,
  developerMode,
  detectionTimeMs,
  complexityLines,
}: {
  label: string;
  field: DetectedField | null;
  developerMode: boolean;
  detectionTimeMs?: number;
  complexityLines?: string[];
}) {
  const [open, setOpen] = useState(false);
  if (!field) return null;

  const isClientUnknown = label.toLowerCase() === "client" && !field.value;
  const alternative = alternativeConsidered(field);
  const altReason = alternativeRejectionReason(field);

  return (
    <div className="text-xs text-slate-600 dark:text-slate-400">
      <button
        type="button"
        className="flex items-center gap-1 text-left font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Why this decision?
      </button>
      {open ? (
        <div className="mt-2 space-y-2 pl-4">
          <p>
            <span className="font-medium text-slate-700 dark:text-slate-300">Decision: </span>
            {displayValueForField(field, label)}
          </p>
          <p>
            <span className="font-medium text-slate-700 dark:text-slate-300">Reason: </span>
            {isClientUnknown ? CLIENT_UNKNOWN_REASON : humanDecisionSummary(field)}
          </p>
          {field.confidence !== "none" && field.value ? (
            <p>
              <span className="font-medium text-slate-700 dark:text-slate-300">How sure: </span>
              {confidencePresentation(field.confidence).title} — {confidencePresentation(field.confidence).explanation}
            </p>
          ) : null}
          {alternative ? (
            <p>
              <span className="font-medium text-slate-700 dark:text-slate-300">Alternative considered: </span>
              {alternative}
              {altReason ? ` — ${altReason}` : ""}
            </p>
          ) : null}
          {complexityLines?.length ? (
            <div>
              <span className="font-medium text-slate-700 dark:text-slate-300">Based on:</span>
              <ul className="mt-1 list-inside list-disc">
                {complexityLines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {developerMode ? (
            <pre className="overflow-x-auto rounded bg-slate-900/90 p-2 font-mono text-[10px] text-slate-200">
              {developerTraceLines(field, detectionTimeMs).join("\n") || "No technical trace."}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function DetectedFieldRow({
  label,
  value,
  field,
  editing,
  onEdit,
  onChange,
  placeholder,
  required,
  developerMode,
  detection,
  preview,
}: {
  label: string;
  value: string;
  field: DetectedField | null;
  editing: boolean;
  onEdit: () => void;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  developerMode: boolean;
  detection?: ProjectDetectionResult | null;
  preview?: XerProjectPreview | null;
}) {
  const hasDetection = Boolean(field?.value);
  const showDetected = hasDetection && !editing;
  const isClientUnknown = label.toLowerCase() === "client" && !field?.value && !value;
  const isComplexity = label.toLowerCase() === "complexity";
  const complexityLines =
    isComplexity && detection && preview ? complexityHumanSummary(detection, preview) : undefined;

  return (
    <div className="space-y-2 border-b border-slate-100 py-4 last:border-b-0 dark:border-slate-800">
      <div className="flex items-start justify-between gap-2">
        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">
          {label}
          {required ? " *" : ""}
        </label>
        {showDetected || isClientUnknown ? (
          <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs" onClick={onEdit}>
            <Pencil className="h-3 w-3" /> {isClientUnknown ? "Add" : "Change"}
          </Button>
        ) : null}
      </div>

      {showDetected ? (
        <div className="space-y-2">
          <p className="text-base font-medium text-slate-900 dark:text-white">{value || field?.value}</p>
          {field && field.confidence !== "none" ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              <span className="text-slate-600 dark:text-slate-300">
                {confidencePresentation(field.confidence).title}
              </span>
              <span className="mx-1">·</span>
              {confidencePresentation(field.confidence).explanation}
            </p>
          ) : null}
          {isComplexity && complexityLines?.length ? (
            <ul className="list-inside list-disc text-xs text-slate-500 dark:text-slate-400">
              {complexityLines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <FieldDecisionPanel
            label={label}
            field={field}
            developerMode={developerMode}
            detectionTimeMs={detection?.detectionTimeMs}
            complexityLines={complexityLines}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {isClientUnknown ? (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs leading-relaxed dark:bg-slate-900/50">
              <p className="font-medium text-slate-800 dark:text-slate-200">Not identified</p>
              <p className="mt-1 text-slate-600 dark:text-slate-400">{NOT_IDENTIFIED_EXPLANATION}</p>
              <p className="mt-1 text-slate-500 dark:text-slate-500">{CLIENT_UNKNOWN_SOURCE}</p>
            </div>
          ) : !value && !hasDetection ? (
            <p className="text-xs text-slate-500 dark:text-slate-400">Needs confirmation</p>
          ) : null}
          <Input
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            required={required}
            autoFocus={editing}
          />
          {field ? (
            <FieldDecisionPanel
              label={label}
              field={field}
              developerMode={developerMode}
              detectionTimeMs={detection?.detectionTimeMs}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}

// Legacy exports kept for any other imports — thin wrappers
export function ProgrammeAnalysisCard({
  detection,
  preview,
}: {
  detection: ProjectDetectionResult;
  preview: XerProjectPreview | null;
}) {
  if (!preview) return null;
  return (
    <div className="space-y-4">
      <DetectedSummaryGrid detection={detection} />
      <RequiresAttentionSection detection={detection} />
      <AnalysisSummaryCard preview={preview} detection={detection} />
    </div>
  );
}

export function ReadinessBanner({ detection }: { detection: ProjectDetectionResult | null }) {
  if (!detection) return null;
  return null;
}

export function ConfidenceBadge({ confidence }: { confidence: DetectionConfidence }) {
  const { title, explanation } = confidencePresentation(confidence);
  if (confidence === "none") return null;
  return (
    <p className="text-xs text-slate-500 dark:text-slate-400">
      <span className="text-slate-600 dark:text-slate-300">{title}</span>
      <span className="mx-1">·</span>
      {explanation}
    </p>
  );
}

export function DetectedPreviewRow({ label, field }: { label: string; field: DetectedField }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-medium">{displaySummaryValue(field, label)}</dd>
    </div>
  );
}
