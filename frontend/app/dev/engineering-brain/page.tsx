"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import {
  devApi,
  getApiErrorMessage,
  isAxiosError,
  type BrainInboxItem,
  type DeliverableContextView,
  type EngineeringBrainDiagnosticsReport,
  type EngineeringComponentView,
  type EngineeringIdentityFields,
  type EngineeringIdentityView,
  type EngineeringReviewPayload,
  type HistoricalMatch,
  type InboxReasonDetail,
  type TrustedKnowledgeEntry,
  type WhyExplanation,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

const IDENTITY_FIELDS: Array<{ key: keyof EngineeringIdentityFields; label: string }> = [
  { key: "discipline", label: "Discipline" },
  { key: "engineeringObject", label: "Engineering object" },
  { key: "engineeringWork", label: "Engineering work" },
  { key: "deliverableType", label: "Deliverable type" },
  { key: "lifecycleStage", label: "Lifecycle" },
];

function Bar({ label, value }: { label: string; value: number }) {
  const tone =
    value >= 85 ? "bg-emerald-500" : value >= 65 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-600 dark:text-slate-300">{label}</span>
        <span className="font-mono text-slate-500 dark:text-slate-400">{value}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
        <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

function Metric({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className={`text-2xl font-semibold ${warn && value > 0 ? "text-rose-600 dark:text-rose-300" : "text-slate-900 dark:text-white"}`}>
        {value}
      </div>
      <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{label}</div>
    </div>
  );
}

const READINESS_TONE: Record<string, string> = {
  READY_TO_LEARN: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  MATURING: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  NOT_READY: "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200",
};

const STATUS_LABEL: Record<string, string> = {
  AUTO_APPROVED: "Auto approved",
  DEVELOPER_APPROVED: "Developer approved",
  DEVELOPER_MODIFIED: "Developer modified",
  REJECTED: "Rejected",
};

function identityLine(identity: EngineeringIdentityFields): string {
  const parts = [identity.discipline, identity.engineeringObject, identity.engineeringWork].filter(Boolean);
  return parts.length ? parts.join(" · ") : "— unresolved —";
}

type EditingState = { fingerprint: string; identity: EngineeringIdentityFields; aliases: string };

function SubHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </span>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">{label}</span>
      <span className="text-sm text-slate-800 dark:text-slate-200">{value || "—"}</span>
    </div>
  );
}

function ContextPanel({ context }: { context: DeliverableContextView }) {
  return (
    <div className="space-y-2">
      <SubHeading>Original deliverable — what Rana saw</SubHeading>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KeyValue label="Project" value={context.projectName} />
        <KeyValue label="Fragnet" value={context.fragnetName} />
        <KeyValue label="Parent WBS" value={context.parentWbs} />
        <KeyValue label="WBS path" value={context.wbsPath} />
        <KeyValue label="Discipline metadata" value={context.disciplineMetadata} />
        <KeyValue label="Lifecycle" value={context.lifecycleStage} />
      </div>
      <KeyValue label="Deliverable" value={context.deliverableName} />
      <div>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Neighbouring deliverables</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {context.neighbouringDeliverables.length ? (
            context.neighbouringDeliverables.map((n) => <Chip key={n}>{n}</Chip>)
          ) : (
            <span className="text-xs text-slate-400">None</span>
          )}
        </div>
      </div>
      <div>
        <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Related activities</span>
        <div className="mt-1 flex flex-wrap gap-1">
          {context.relatedActivities.length ? (
            context.relatedActivities.slice(0, 12).map((a) => <Chip key={a}>{a}</Chip>)
          ) : (
            <span className="text-xs text-slate-400">None</span>
          )}
        </div>
      </div>
      {context.classificationTags.length ? (
        <div>
          <span className="text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">Classification tags</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {context.classificationTags.map((t) => (
              <Chip key={t}>{t}</Chip>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function componentRow(label: string, c: EngineeringComponentView) {
  return { label, c };
}

function ConfidenceBreakdown({ view }: { view: EngineeringIdentityView }) {
  const rows = [
    componentRow("Discipline", view.discipline),
    componentRow("Engineering Object", view.engineeringObject),
    componentRow("Engineering Work", view.engineeringWork),
    componentRow("Deliverable Type", view.deliverableType),
    componentRow("Lifecycle", view.lifecycleStage),
    componentRow("Project Context", view.projectContext),
  ];
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <SubHeading>Engineering identity & confidence</SubHeading>
        <span className="text-xs text-slate-500 dark:text-slate-400">Overall {view.overallConfidence}%</span>
      </div>
      <div className="space-y-2">
        {rows.map(({ label, c }) => (
          <div key={label} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2">
            <span className="text-xs text-slate-600 dark:text-slate-300">{label}</span>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full ${c.confidence >= 85 ? "bg-emerald-500" : c.confidence >= 60 ? "bg-amber-500" : "bg-rose-500"}`}
                style={{ width: `${Math.max(0, Math.min(100, c.confidence))}%` }}
              />
            </div>
            <span className="text-right font-mono text-[11px] text-slate-500 dark:text-slate-400">
              {c.label ? `${c.confidence}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReasonPanel({ details }: { details: InboxReasonDetail[] }) {
  if (details.length === 0) return null;
  return (
    <div className="space-y-2">
      <SubHeading>Why this needs review</SubHeading>
      {details.map((d, i) => (
        <div key={`${d.reason}-${i}`} className="rounded-md border border-amber-200 bg-amber-50/60 p-2 text-sm dark:border-amber-900/50 dark:bg-amber-900/10">
          <div className="font-medium text-amber-900 dark:text-amber-200">{d.reason.replace(/_/g, " ").toLowerCase()}</div>
          <div className="text-slate-700 dark:text-slate-300">{d.detail}</div>
          {d.validationRule ? (
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Validator rule: {d.validationRule}</div>
          ) : null}
          {typeof d.modelConfidence === "number" ? (
            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">Model confidence: {d.modelConfidence}%</div>
          ) : null}
          {d.closestKnownObjects && d.closestKnownObjects.length ? (
            <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
              Closest known objects:
              {d.closestKnownObjects.map((o) => (
                <Chip key={o}>{o}</Chip>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function HistoricalTable({ matches }: { matches: HistoricalMatch[] }) {
  return (
    <div className="space-y-2">
      <SubHeading>Historical evidence Rana would use</SubHeading>
      {matches.length === 0 ? (
        <p className="text-xs text-slate-400">No equivalent historical identities. If trusted, this would have no duration precedent yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                <th className="pb-1 pr-3 font-medium">Project</th>
                <th className="pb-1 pr-3 font-medium">Fragnet</th>
                <th className="pb-1 pr-3 font-medium">Deliverable</th>
                <th className="pb-1 pr-3 font-medium">Duration</th>
                <th className="pb-1 font-medium">Matched on</th>
              </tr>
            </thead>
            <tbody>
              {matches.map((m, i) => (
                <tr key={`${m.projectName}-${m.deliverableName}-${i}`} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1 pr-3">{m.projectName}</td>
                  <td className="py-1 pr-3 text-slate-500 dark:text-slate-400">{m.fragnetName ?? "—"}</td>
                  <td className="py-1 pr-3">{m.deliverableName}</td>
                  <td className="py-1 pr-3">{m.durationDays != null ? `${m.durationDays} d` : "—"}</td>
                  <td className="py-1 text-slate-500 dark:text-slate-400">{m.matchedComponents.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WhyPanel({ why }: { why: WhyExplanation[] }) {
  const [open, setOpen] = useState(false);
  if (why.length === 0) return null;
  return (
    <div>
      <button
        type="button"
        className="text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide reasoning" : "Why? (deterministic explanation)"}
      </button>
      {open ? (
        <div className="mt-2 space-y-2 rounded-md border border-slate-200 p-2 dark:border-slate-700">
          {why.map((w) => (
            <div key={w.component} className="text-sm">
              <div className="text-slate-800 dark:text-slate-200">
                I classified <span className="font-medium">{w.component}</span> as{" "}
                <span className="font-medium">{w.conclusion}</span> because:
              </div>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-slate-600 dark:text-slate-300">
                {w.because.map((b, i) => (
                  <li key={i}>{b}</li>
                ))}
              </ul>
              {w.rejectedAlternatives.length ? (
                <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  Rejected alternatives:
                  {w.rejectedAlternatives.map((a) => (
                    <Chip key={a}>{a}</Chip>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ImpactPanel({ item }: { item: BrainInboxItem }) {
  return (
    <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs dark:border-slate-700 dark:bg-slate-800/40">
      <span className="font-medium text-slate-700 dark:text-slate-200">Approving/modifying will affect: </span>
      {item.impact.deliverables} deliverable(s) · {item.impact.projects} project(s) ·{" "}
      {item.impact.futureComparisons} future comparison(s) · {item.impact.historicalDurationMatches} historical duration match(es)
    </div>
  );
}

function IdentityEditor({
  editing,
  setEditing,
  onSave,
  onCancel,
  busy,
  saveLabel,
}: {
  editing: EditingState;
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  saveLabel: string;
}) {
  return (
    <div className="grid gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-2 dark:border-slate-700">
      {IDENTITY_FIELDS.map((field) => (
        <label key={field.key} className="text-xs text-slate-600 dark:text-slate-300">
          {field.label}
          <input
            className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
            value={editing.identity[field.key] ?? ""}
            onChange={(e) =>
              setEditing((prev) =>
                prev ? { ...prev, identity: { ...prev.identity, [field.key]: e.target.value || null } } : prev
              )
            }
          />
        </label>
      ))}
      <label className="text-xs text-slate-600 sm:col-span-2 dark:text-slate-300">
        Supporting aliases (comma separated)
        <input
          className="mt-1 w-full rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
          value={editing.aliases}
          onChange={(e) => setEditing((prev) => (prev ? { ...prev, aliases: e.target.value } : prev))}
        />
      </label>
      <div className="sm:col-span-2 flex gap-2">
        <Button type="button" size="sm" disabled={busy} onClick={onSave}>
          {saveLabel}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function aliasesToArray(aliases: string): string[] {
  return aliases
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
}

function InboxCard({
  item,
  editing,
  setEditing,
  busy,
  review,
}: {
  item: BrainInboxItem;
  editing: EditingState | null;
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>;
  busy: boolean;
  review: (payload: EngineeringReviewPayload) => void;
}) {
  const isEditing = editing?.fingerprint === item.fingerprint;
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white">{item.concept}</span>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${item.state === "CONTRADICTORY" ? "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" : "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200"}`}
            >
              {item.state.replace(/_/g, " ")}
            </span>
            <span className="text-xs text-slate-400">·  seen {item.occurrences} across {item.projects} project(s)</span>
          </div>
          <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">Current identity: {identityLine(item.identity)}</div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              review({
                fingerprint: item.fingerprint,
                action: "approve",
                concept: item.concept,
                identity: item.identity,
                evidence: item.evidence,
                observed: { projectCount: item.projects },
              })
            }
          >
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setEditing(isEditing ? null : { fingerprint: item.fingerprint, identity: { ...item.identity }, aliases: "" })
            }
          >
            {isEditing ? "Cancel" : "Modify"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-rose-600 dark:text-rose-300"
            disabled={busy}
            onClick={() =>
              review({ fingerprint: item.fingerprint, action: "reject", concept: item.concept, identity: item.identity })
            }
          >
            Reject
          </Button>
        </div>
      </div>

      {item.examples.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.examples.map((ex) => (
            <Chip key={`${ex.projectName}-${ex.deliverableName}`}>
              {ex.projectName}: {ex.deliverableName}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ContextPanel context={item.context} />
        <ConfidenceBreakdown view={item.identityView} />
      </div>
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        <ReasonPanel details={item.reasonDetails} />
        <HistoricalTable matches={item.historicalMatches} />
      </div>
      <div className="mt-3 space-y-2">
        <WhyPanel why={item.why} />
        <ImpactPanel item={item} />
      </div>

      {isEditing && editing ? (
        <div className="mt-3">
          <IdentityEditor
            editing={editing}
            setEditing={setEditing}
            busy={busy}
            saveLabel="Save as Trusted Knowledge"
            onCancel={() => setEditing(null)}
            onSave={() =>
              review({
                fingerprint: item.fingerprint,
                action: "modify",
                concept: item.concept,
                identity: editing.identity,
                aliases: aliasesToArray(editing.aliases),
                evidence: item.evidence,
                observed: { projectCount: item.projects },
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

function TrustedRow({
  entry,
  editing,
  setEditing,
  busy,
  review,
}: {
  entry: TrustedKnowledgeEntry;
  editing: EditingState | null;
  setEditing: React.Dispatch<React.SetStateAction<EditingState | null>>;
  busy: boolean;
  review: (payload: EngineeringReviewPayload) => void;
}) {
  const [open, setOpen] = useState(false);
  const isEditing = editing?.fingerprint === entry.fingerprint;
  return (
    <div className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-white">{entry.concept}</span>
            <span
              className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${entry.status === "AUTO_APPROVED" ? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"}`}
            >
              {STATUS_LABEL[entry.status] ?? entry.status}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{identityLine(entry.identity)}</div>
          <div className="mt-0.5 text-xs text-slate-400">
            {entry.projectCount} project(s) · {entry.successfulComparisons} comparison(s) ·{" "}
            {new Date(entry.firstObserved).toLocaleDateString()} → {new Date(entry.lastObserved).toLocaleDateString()}
            {entry.versionHistoryCount ? ` · ${entry.versionHistoryCount} revision(s)` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Inspect"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              setEditing(
                isEditing
                  ? null
                  : { fingerprint: entry.fingerprint, identity: { ...entry.identity }, aliases: entry.aliases.join(", ") }
              )
            }
          >
            {isEditing ? "Cancel" : "Edit"}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="mt-3 space-y-4">
          {entry.identityView ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {entry.context ? <ContextPanel context={entry.context} /> : <div />}
              <ConfidenceBreakdown view={entry.identityView} />
            </div>
          ) : null}
          <HistoricalTable matches={entry.historicalMatches} />
          {entry.lastModificationReason ? (
            <div className="text-xs text-slate-500 dark:text-slate-400">
              Last modification: {entry.lastModificationReason}
            </div>
          ) : null}
          {entry.versionHistory.length ? (
            <div>
              <SubHeading>Version history</SubHeading>
              <ul className="mt-1 space-y-1 text-xs text-slate-600 dark:text-slate-300">
                {entry.versionHistory.map((v, i) => (
                  <li key={i}>
                    {new Date(v.at).toLocaleString()} — {v.action} ({v.status}){v.reviewedBy ? ` by ${v.reviewedBy}` : ""}
                    {v.notes ? `: ${v.notes}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {isEditing && editing ? (
        <div className="mt-3">
          <IdentityEditor
            editing={editing}
            setEditing={setEditing}
            busy={busy}
            saveLabel="Save changes"
            onCancel={() => setEditing(null)}
            onSave={() =>
              review({
                fingerprint: entry.fingerprint,
                action: "modify",
                concept: entry.concept,
                identity: editing.identity,
                aliases: aliasesToArray(editing.aliases),
              })
            }
          />
        </div>
      ) : null}
    </div>
  );
}

export default function EngineeringBrainPage() {
  const { user, loading, refreshUser } = useAuth();
  const router = useRouter();
  const [forbidden, setForbidden] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [report, setReport] = useState<EngineeringBrainDiagnosticsReport | null>(null);
  const [busyFingerprint, setBusyFingerprint] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoadingData(true);
    setForbidden(false);
    try {
      const res = await devApi.engineeringBrain();
      setReport(res.data);
    } catch (err) {
      if (isAxiosError(err) && err.response?.status === 403) setForbidden(true);
      else toast.error(getApiErrorMessage(err));
      setReport(null);
    } finally {
      setLoadingData(false);
    }
  }, []);

  const review = useCallback(
    async (payload: EngineeringReviewPayload) => {
      setBusyFingerprint(payload.fingerprint);
      try {
        await devApi.reviewEngineeringIdentity(payload);
        toast.success(
          payload.action === "approve"
            ? "Approved — now Trusted Knowledge"
            : payload.action === "modify"
              ? "Modified — Trusted Knowledge updated"
              : "Rejected"
        );
        setEditing(null);
        await load();
      } catch (err) {
        toast.error(getApiErrorMessage(err));
      } finally {
        setBusyFingerprint(null);
      }
    },
    [load]
  );

  const exportIdentityDebug = useCallback(async () => {
    setExporting(true);
    try {
      const res = await devApi.exportIdentityReviewDebug();
      const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const date = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `identity-review-${date}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(
        `Exported ${res.data.summary.deliverableCount} deliverable(s) · schema ${res.data.schemaVersion}`
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setExporting(false);
    }
  }, []);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace(`/login?next=${encodeURIComponent("/dev/engineering-brain")}`);
      return;
    }
    if (user.devPanelAccess === undefined) {
      void refreshUser();
      return;
    }
    if (user.devPanelAccess !== true) {
      setForbidden(true);
      return;
    }
    void load();
  }, [user, loading, router, load, refreshUser]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-sm text-slate-500 dark:text-slate-400">Loading…</p>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <Card className="dark:border-slate-800 dark:bg-slate-900/50">
          <CardHeader>
            <CardTitle className="text-lg">Private dev area</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-slate-600 dark:text-slate-300">
            <p>
              The Engineering Brain dashboard (<code className="font-mono">/dev/engineering-brain</code>) is restricted to
              developer accounts.
            </p>
            <Button asChild variant="default">
              <Link href="/login?next=/dev/engineering-brain">Sign in as dev user</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-6 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Engineering Brain</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Developer-only diagnostics. Observation, validation and self-assessment — no learning, no planner impact.
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" disabled={loadingData} onClick={() => void load()}>
            {loadingData ? "Refreshing…" : "Refresh"}
          </Button>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportIdentityDebug()}>
            {exporting ? "Exporting…" : "Export Identity Debug JSON"}
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link href="/dev">Back to dev panel</Link>
          </Button>
        </div>
      </div>

      <Card className="border-slate-300 dark:border-slate-700 dark:bg-slate-900/50">
        <CardHeader>
          <CardTitle className="text-base">Developer Tools</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Export every stage of the identity-resolution pipeline as JSON. Completeness over size — for AI-assisted
            debugging. This page is already developer-only; planners never see it.
          </p>
        </CardHeader>
        <CardContent>
          <Button type="button" variant="outline" size="sm" disabled={exporting} onClick={() => void exportIdentityDebug()}>
            {exporting ? "Exporting…" : "Export Identity Debug JSON"}
          </Button>
        </CardContent>
      </Card>

      {!report ? (
        <p className="text-sm text-slate-500">{loadingData ? "Analysing imported programmes…" : "No data."}</p>
      ) : (
        <>
          {/* Maturity */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="text-base">Engineering Maturity</CardTitle>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500 dark:text-slate-400">Overall</span>
                <span className="text-xl font-semibold text-slate-900 dark:text-white">{report.maturity.overall}%</span>
                <span className={`rounded px-2 py-1 text-[11px] font-semibold uppercase tracking-wide ${READINESS_TONE[report.maturity.readiness]}`}>
                  {report.maturity.readiness.replace(/_/g, " ")}
                </span>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-3">
                <Bar label="Consistency" value={report.maturity.dimensions.consistency} />
                <Bar label="Explainability" value={report.maturity.dimensions.explainability} />
                <Bar label="Validation success" value={report.maturity.dimensions.validationSuccess} />
                <Bar label="Coverage (inverse unknown rate)" value={report.maturity.dimensions.coverage} />
              </div>
              <div className="space-y-3">
                <Bar label="Contradiction control" value={report.maturity.dimensions.contradictionControl} />
                <Bar label="Repeatability" value={report.maturity.dimensions.repeatability} />
                <Bar label="Reasoning stability" value={report.maturity.dimensions.reasoningStability} />
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-3 rounded-md border border-slate-200 p-3 sm:grid-cols-5 dark:border-slate-700">
                <Metric label="Auto-trusted %" value={report.maturity.trust.autoTrustedRate} />
                <Metric label="Needs review %" value={report.maturity.trust.reviewRate} warn />
                <Metric label="Dev modified %" value={report.maturity.trust.developerModificationRate} />
                <Metric label="Dev rejected %" value={report.maturity.trust.developerRejectionRate} warn />
                <Metric label="Agreement %" value={report.maturity.trust.trustedAgreement} />
              </div>
              {report.maturity.rationale.length > 0 ? (
                <ul className="md:col-span-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  {report.maturity.rationale.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : null}
            </CardContent>
          </Card>

          {/* Brain Inbox */}
          <Card className="border-amber-200 dark:border-amber-900/50 dark:bg-slate-900/50">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">Brain Inbox</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Only identities the Engineering Brain is genuinely unsure about. Everything else auto-trusts.
                </p>
              </div>
              <span className="rounded bg-amber-100 px-2 py-1 text-sm font-semibold text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                {report.summary.brainInbox}
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {!report.storeAvailable ? (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  Knowledge store offline — review decisions won&apos;t persist until the migration is deployed.
                </p>
              ) : null}
              {report.brainInbox.length === 0 ? (
                <p className="text-sm text-slate-500">Nothing to review. The Brain is confident about everything it has seen.</p>
              ) : (
                report.brainInbox.map((item) => (
                  <InboxCard
                    key={item.fingerprint}
                    item={item}
                    editing={editing}
                    setEditing={setEditing}
                    busy={busyFingerprint === item.fingerprint}
                    review={(payload) => void review(payload)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {/* Trusted Knowledge */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">Trusted Knowledge</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Rana&apos;s approved engineering understanding. Participates in comparison and future reasoning. Inspect any entry read-only.
                </p>
              </div>
              <span className="rounded bg-emerald-100 px-2 py-1 text-sm font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                {report.summary.trustedKnowledge}
              </span>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.trustedKnowledge.length === 0 ? (
                <p className="text-sm text-slate-500">No trusted knowledge yet.</p>
              ) : (
                report.trustedKnowledge.slice(0, 100).map((entry) => (
                  <TrustedRow
                    key={entry.fingerprint}
                    entry={entry}
                    editing={editing}
                    setEditing={setEditing}
                    busy={busyFingerprint === entry.fingerprint}
                    review={(payload) => void review(payload)}
                  />
                ))
              )}
            </CardContent>
          </Card>

          {/* Metrics */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-base">Behaviour across imported programmes</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Metric label="Projects analysed" value={report.metrics.projectsAnalysed} />
              <Metric label="Imports analysed" value={report.metrics.importsAnalysed} />
              <Metric label="Engineering identities" value={report.metrics.engineeringIdentitiesCreated} />
              <Metric label="Equivalent comparisons" value={report.metrics.equivalentComparisons} />
              <Metric label="Rejected comparisons" value={report.metrics.rejectedComparisons} />
              <Metric label="Unknown objects" value={report.metrics.unknownEngineeringObjects} warn />
              <Metric label="Unknown work" value={report.metrics.unknownEngineeringWork} warn />
              <Metric label="Contradictory identities" value={report.metrics.contradictoryIdentities} warn />
              <Metric label="Validation failures" value={report.metrics.validationFailures} warn />
              <Metric label="Potential new objects" value={report.metrics.potentialNewEngineeringObjects} />
              <Metric label="Potential new work" value={report.metrics.potentialNewEngineeringWork} />
              <Metric label="Reasoning consistency %" value={report.metrics.reasoningConsistency} />
            </CardContent>
          </Card>

          {/* Top opportunities */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-base">If I had to learn one thing today…</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Where the engineering brain is weakest — ranked concepts that would most improve understanding. Observation only.
              </p>
            </CardHeader>
            <CardContent>
              {report.topOpportunities.length === 0 ? (
                <p className="text-sm text-slate-500">No unknown concepts observed.</p>
              ) : (
                <ol className="space-y-2">
                  {report.topOpportunities.map((op) => (
                    <li key={op.rank} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 dark:border-slate-700">
                      <span className="font-medium text-slate-900 dark:text-white">
                        {op.rank}. {op.concept}
                      </span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">
                        Seen {op.seen} · Projects {op.projects} · Consistency {op.consistency}%
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Consistency probes */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-base">Consistency analysis</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Do wording variants of the same engineering work resolve to one identity?
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.consistency.probes.map((probe) => (
                <div key={probe.concept} className="rounded-md border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-900 dark:text-white">{probe.concept}</span>
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${probe.verdict === "CONSISTENT" ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200"}`}
                    >
                      {probe.verdict === "CONSISTENT" ? "Consistent" : probe.reason.replace(/_/g, " ")}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-slate-500 dark:text-slate-400">
                    {probe.variants.map((v) => v.name).join("  →  ")}
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Observed concepts: {report.consistency.observedConceptsAnalysed} · consistent {report.consistency.consistentConcepts} · inconsistent {report.consistency.inconsistentConcepts}
              </p>
            </CardContent>
          </Card>

          {/* Unknown analysis */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader>
                <CardTitle className="text-base">Unknown engineering objects</CardTitle>
              </CardHeader>
              <CardContent>
                {report.unknownObjects.length === 0 ? (
                  <p className="text-sm text-slate-500">None.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <th className="pb-2 pr-4 font-medium">Concept</th>
                          <th className="pb-2 pr-4 font-medium">Occ.</th>
                          <th className="pb-2 pr-4 font-medium">Projects</th>
                          <th className="pb-2 font-medium">Confidence</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.unknownObjects.slice(0, 20).map((u) => (
                          <tr key={u.concept} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-2 pr-4">{u.concept}</td>
                            <td className="py-2 pr-4">{u.occurrences}</td>
                            <td className="py-2 pr-4">{u.projects}</td>
                            <td className="py-2">{u.confidence}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader>
                <CardTitle className="text-base">Candidate learning (observe only)</CardTitle>
              </CardHeader>
              <CardContent>
                {report.candidateLearning.length === 0 ? (
                  <p className="text-sm text-slate-500">No candidates yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400">
                          <th className="pb-2 pr-4 font-medium">Candidate</th>
                          <th className="pb-2 pr-4 font-medium">Observed</th>
                          <th className="pb-2 pr-4 font-medium">Projects</th>
                          <th className="pb-2 pr-4 font-medium">Consistency</th>
                          <th className="pb-2 font-medium">Contra.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.candidateLearning.map((c) => (
                          <tr key={c.candidate} className="border-b border-slate-100 dark:border-slate-800">
                            <td className="py-2 pr-4">{c.candidate}</td>
                            <td className="py-2 pr-4">{c.observed}</td>
                            <td className="py-2 pr-4">{c.projects}</td>
                            <td className="py-2 pr-4">{c.consistency}%</td>
                            <td className="py-2">{c.contradictions}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Reasoning drift */}
          {report.reasoningDrift.length > 0 ? (
            <Card className="dark:border-slate-800 dark:bg-slate-900/50">
              <CardHeader>
                <CardTitle className="text-base">Reasoning drift</CardTitle>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Same engineering work resolving to different engineering objects across imports.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                {report.reasoningDrift.slice(0, 20).map((drift) => (
                  <div key={drift.concept} className="rounded-md border border-amber-200 p-3 dark:border-amber-900/50">
                    <div className="text-sm font-medium text-slate-900 dark:text-white">{drift.concept}</div>
                    <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {drift.variants.map((v) => `${v.resolvedTo} (${v.projectName})`).join("  vs  ")}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {/* Versions */}
          <Card className="dark:border-slate-800 dark:bg-slate-900/50">
            <CardHeader>
              <CardTitle className="text-base">Versioning</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Every Engineering Identity is stamped with these versions so historical reasoning stays reproducible.
              </p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
              <div>Brain: {report.versions.brain}</div>
              <div>Prompt: {report.versions.reasoningPrompt}</div>
              <div>Vocabulary: {report.versions.vocabulary}</div>
              <div>Validation: {report.versions.validation}</div>
              <div className="col-span-2 text-slate-500 sm:col-span-4">Generated {new Date(report.generatedAt).toLocaleString()}</div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
