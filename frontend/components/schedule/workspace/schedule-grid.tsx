"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, AlertCircle, AlertTriangle } from "lucide-react";
import { CriticalActivityBadge } from "@/components/schedule/critical-activity-badge";
import { RelationshipTypeBadge } from "@/components/schedule/relationship-type-badge";
import { ScheduleEditableCell } from "@/components/schedule/workspace/schedule-editable-cell";
import { cpmLookupActivityId } from "@/lib/schedule-effective";
import type { WorkspaceRow } from "@/lib/schedule-workspace-data";
import type { RowDiagnostic } from "@/lib/schedule-workspace-data";
import {
  SCHEDULE_GRID_HEADER_HEIGHT,
  SCHEDULE_ROW_HEIGHT,
  visibleRowRange,
} from "@/lib/schedule-timeline";
import { cn } from "@/lib/utils";
import { ScheduleIntelligenceCue } from "@/components/schedule/schedule-intelligence-cue";
import type { DeliverableStatusSnapshot } from "@/lib/deliverable-intelligence-status";

export type ScheduleEditField = "code" | "name" | "bestDur" | "likelyDur";

export type ScheduleActivityPatch = {
  activityCode?: string;
  name?: string;
  bestDuration?: number;
  likelyDuration?: number;
};

const ROW_HEIGHT = SCHEDULE_ROW_HEIGHT;
const HEADER_HEIGHT = SCHEDULE_GRID_HEADER_HEIGHT;

const COLS = [
  { key: "tree", label: "", w: 28 },
  { key: "code", label: "ID", w: 88 },
  { key: "name", label: "Activity Name", w: 260 },
  { key: "best", label: "Best", w: 44 },
  { key: "likely", label: "Likely", w: 48 },
  { key: "tf", label: "TF", w: 40 },
  { key: "crit", label: "Crit", w: 52 },
  { key: "res", label: "Res", w: 40 },
  { key: "rel", label: "Rel", w: 72 },
] as const;

const gridMinWidth = COLS.reduce((s, c) => s + c.w, 0);

function DiagIcons(props: { diagnostics: RowDiagnostic[] }) {
  const critical = props.diagnostics.filter((d) => d.severity === "critical");
  const warning = props.diagnostics.filter((d) => d.severity === "warning");
  if (critical.length === 0 && warning.length === 0) return null;
  return (
    <span className="ml-1 inline-flex gap-0.5">
      {critical.length > 0 && (
        <span title={critical.map((d) => d.message).join("\n")}>
          <AlertCircle className="h-3.5 w-3.5 text-red-500" />
        </span>
      )}
      {warning.length > 0 && (
        <span title={warning.map((d) => d.message).join("\n")}>
          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
        </span>
      )}
    </span>
  );
}

function GridRow(props: {
  row: WorkspaceRow;
  selected: boolean;
  hovered: boolean;
  diagnostics: RowDiagnostic[];
  canEdit: boolean;
  saving: boolean;
  editing: { rowKey: string; field: ScheduleEditField } | null;
  onStartEdit: (rowKey: string, field: ScheduleEditField) => void;
  onCancelEdit: () => void;
  onSave: (row: WorkspaceRow, field: ScheduleEditField, value: string) => void;
  onSelect: (id: string | null, fragnetId: string) => void;
  onHover: (id: string | null) => void;
  onToggleFragnet: (id: string) => void;
  onToggleDeliverable: (id: string) => void;
  onToggleSharedGroup: (fragnetId: string) => void;
  onToggleSharedActivity: (activityId: string) => void;
  fragnetOpen: boolean;
  deliverableOpen: boolean;
  sharedGroupOpen: boolean;
  sharedActivityOpen: boolean;
  isLogicPred: boolean;
  isLogicSucc: boolean;
  onSelectSuccessor: (id: string | null, fragnetId: string) => void;
  deliverableIntel?: DeliverableStatusSnapshot;
  onDeliverableIntelClick?: () => void;
}) {
  const { row, selected, hovered, diagnostics, onSelect, onHover, onSelectSuccessor, canEdit, saving, editing, isLogicPred, isLogicSucc } =
    props;
  const nodeId = row.scheduleNodeId ?? row.activityId ?? null;
  const isEditing = (field: ScheduleEditField) =>
    editing?.rowKey === row.key && editing.field === field;
  const hasDiag = diagnostics.length > 0;
  const isCritical = row.cpm?.isCritical === true;

  if (row.kind === "fragnet") {
    return (
      <div
        className={cn(
          "flex items-center border-b border-slate-200 bg-slate-100/90 text-xs font-semibold uppercase tracking-wide text-slate-700 dark:border-slate-700 dark:bg-slate-800/90 dark:text-slate-200",
          hovered && "bg-slate-200/80 dark:bg-slate-700/80"
        )}
        style={{ height: ROW_HEIGHT }}
        onMouseEnter={() => onHover(null)}
      >
        <button
          type="button"
          className="flex w-7 shrink-0 items-center justify-center"
          onClick={() => props.onToggleFragnet(row.fragnetId)}
          aria-label="Toggle WBS"
        >
          {props.fragnetOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="truncate px-1" style={{ width: COLS[1].w + COLS[2].w }}>
          WBS · {row.label}
        </span>
      </div>
    );
  }

  if (row.kind === "sharedGroup") {
    return (
      <div
        className={cn(
          "flex items-center border-b border-cyan-100 bg-cyan-50/60 text-xs font-medium text-cyan-900 dark:border-cyan-900/50 dark:bg-cyan-950/30 dark:text-cyan-100",
          hovered && "bg-cyan-100/80 dark:bg-cyan-900/40"
        )}
        style={{ height: ROW_HEIGHT }}
        onMouseEnter={() => onHover(null)}
      >
        <button
          type="button"
          className="flex w-7 shrink-0 items-center justify-center"
          onClick={() => props.onToggleSharedGroup(row.fragnetId)}
          aria-label="Toggle shared activities"
        >
          {props.sharedGroupOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="shrink-0 truncate px-1 font-mono text-[10px] uppercase text-cyan-700 dark:text-cyan-400" style={{ width: COLS[1].w }}>
          SHR
        </span>
        <span className="truncate px-1 font-medium" style={{ width: COLS[2].w }}>
          {row.label}
        </span>
        <span className="shrink-0 px-1 text-slate-500 dark:text-slate-400" style={{ width: COLS[8].w }}>
          {row.relSummary ?? "—"}
        </span>
      </div>
    );
  }

  if (row.kind === "sharedLinkedDeliverable") {
    return (
      <div
        className="flex items-center border-b border-cyan-50/80 bg-cyan-50/20 text-xs text-slate-600 dark:border-cyan-950/40 dark:bg-cyan-950/10 dark:text-slate-400"
        style={{ height: ROW_HEIGHT }}
        onMouseEnter={() => onHover(null)}
      >
        <span className="w-7 shrink-0" />
        <span className="shrink-0" style={{ width: COLS[1].w }} />
        <span className="truncate pl-6" style={{ width: COLS[2].w + COLS[1].w }}>
          <span className="text-slate-400">—</span> {row.label}
        </span>
      </div>
    );
  }

  if (row.kind === "deliverable") {
    const cpm = row.cpm;
    const delRel = row.relSummary ?? "—";
    return (
      <div
        className={cn(
          "flex cursor-pointer items-center border-b border-slate-100 bg-slate-50/80 text-xs font-medium text-slate-800 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200",
          selected && "bg-cyan-500/10 ring-1 ring-inset ring-cyan-500/40",
          isLogicPred && "ring-1 ring-inset ring-amber-400/70",
          isLogicSucc && "ring-1 ring-inset ring-emerald-400/70",
          hovered && "bg-slate-100 dark:bg-slate-800/80"
        )}
        style={{ height: ROW_HEIGHT }}
        onClick={() => onSelect(nodeId, row.fragnetId)}
        onDoubleClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onSelectSuccessor(nodeId, row.fragnetId);
        }}
        onMouseEnter={() => onHover(nodeId)}
        onMouseLeave={() => onHover(null)}
      >
        <button
          type="button"
          className="flex w-7 shrink-0 items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            row.deliverableId && props.onToggleDeliverable(row.deliverableId);
          }}
          aria-label="Toggle deliverable"
        >
          {props.deliverableOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <span className="shrink-0 truncate px-1 font-mono text-[10px] uppercase text-slate-500" style={{ width: COLS[1].w }} title="Deliverable (P6 summary task)">
          DEL
        </span>
        <span className="flex min-w-0 items-center truncate px-1 font-medium" style={{ width: COLS[2].w }} title={row.label}>
          <span className="truncate">{row.label}</span>
          <ScheduleIntelligenceCue
            snapshot={props.deliverableIntel}
            onClick={props.onDeliverableIntelClick}
          />
        </span>
        <span className="shrink-0 px-1 text-right tabular-nums text-slate-600" style={{ width: COLS[3].w }}>
          {row.bestDuration ?? "—"}
        </span>
        <span className="shrink-0 px-1 text-right tabular-nums text-slate-600" style={{ width: COLS[4].w }}>
          {row.likelyDuration ?? "—"}
        </span>
        <span className="shrink-0 px-1 text-slate-400" style={{ width: COLS[5].w }} />
        <span className="shrink-0 px-1 text-slate-400" style={{ width: COLS[6].w }} />
        <span className="shrink-0 px-1 text-slate-400" style={{ width: COLS[7].w }} />
        <span className="shrink-0 px-1 text-slate-600 dark:text-slate-400" style={{ width: COLS[8].w }} title="Deliverable logic">
          {delRel}
        </span>
      </div>
    );
  }

  const cpm = row.cpm;
  const act = row.activity;
  const predTypes = act?.relationships.predecessors ?? [];
  const succTypes = act?.relationships.successors ?? [];
  const firstPred = predTypes[0];
  const firstSucc = succTypes[0];
  const relPreview =
    row.relSummary && row.relSummary !== "—"
      ? row.relSummary
      : firstPred
        ? firstPred.deliverableName
          ? `${firstPred.relationshipType}${firstPred.lag ? `+${firstPred.lag}` : ""}←${firstPred.deliverableName}`
          : `${firstPred.relationshipType}${firstPred.lag ? `+${firstPred.lag}` : ""}←${firstPred.activityCode}`
        : firstSucc
          ? firstSucc.deliverableName
            ? `${firstSucc.relationshipType}${firstSucc.lag ? `+${firstSucc.lag}` : ""}→${firstSucc.deliverableName}`
            : `${firstSucc.relationshipType}${firstSucc.lag ? `+${firstSucc.lag}` : ""}→${firstSucc.activityCode}`
          : "—";
  const bestDurValue = String(row.bestDuration ?? act?.bestDuration ?? "");
  const likelyDurValue = String(row.likelyDuration ?? act?.likelyDuration ?? "");
  const rowEditable = canEdit && !saving && !act?.isExpandedPerDeliverable;
  const linkedDeliverableCount = act?.linkedDeliverables?.length ?? 0;
  const isSharedActivityRow = Boolean(act?.isSharedAcrossDeliverables || row.sharedByLabel);
  const showSharedLinksToggle = isSharedActivityRow && linkedDeliverableCount > 0;

  return (
    <div
      role="row"
      tabIndex={0}
      className={cn(
        "flex cursor-pointer items-center border-b border-slate-100 text-sm dark:border-slate-800/80",
        isSharedActivityRow && "bg-cyan-50/30 dark:bg-cyan-950/15",
        selected && "bg-cyan-500/10 ring-1 ring-inset ring-cyan-500/40",
        isLogicPred && "ring-1 ring-inset ring-amber-400/70",
        isLogicSucc && "ring-1 ring-inset ring-emerald-400/70",
        !selected && hovered && "bg-slate-50 dark:bg-slate-800/50",
        isCritical && !selected && "bg-red-50/40 dark:bg-red-950/15",
        hasDiag && diagnostics.some((d) => d.severity === "critical") && "bg-red-50/60 dark:bg-red-950/25",
        saving && "opacity-60"
      )}
      style={{ height: ROW_HEIGHT }}
      onClick={() => onSelect(nodeId, row.fragnetId)}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelectSuccessor(nodeId, row.fragnetId);
      }}
      onMouseEnter={() => onHover(nodeId)}
      onMouseLeave={() => onHover(null)}
    >
      {showSharedLinksToggle ? (
        <button
          type="button"
          className="flex w-7 shrink-0 items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            row.activityId && props.onToggleSharedActivity(row.activityId);
          }}
          aria-label="Toggle linked deliverables"
        >
          {props.sharedActivityOpen ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </button>
      ) : (
        <span className="w-7 shrink-0" />
      )}
      <span className="relative shrink-0 font-mono font-medium" style={{ width: COLS[1].w }}>
        <ScheduleEditableCell
          value={row.code ?? ""}
          editable={rowEditable}
          active={isEditing("code")}
          mono
          width={COLS[1].w}
          onActivate={() => props.onStartEdit(row.key, "code")}
          onCancel={props.onCancelEdit}
          onCommit={(v) => props.onSave(row, "code", v)}
          validate={(v) => (v.trim() ? null : "Activity ID is required")}
        />
        <DiagIcons diagnostics={diagnostics} />
      </span>
      <span
        className="flex min-w-0 flex-col justify-center gap-0.5 px-0.5"
        style={{ width: COLS[2].w }}
        title={
          row.sharedByLabel
            ? `${row.label}\nShared by: ${row.sharedByLabel}`
            : row.label
        }
      >
        <ScheduleEditableCell
          value={row.label}
          editable={rowEditable}
          active={isEditing("name")}
          width={COLS[2].w}
          onActivate={() => props.onStartEdit(row.key, "name")}
          onCancel={props.onCancelEdit}
          onCommit={(v) => props.onSave(row, "name", v)}
          validate={(v) => (v.trim() ? null : "Name is required")}
        />
        {row.sharedByLabel && !props.sharedActivityOpen ? (
          <span className="truncate text-[10px] leading-tight text-slate-500 dark:text-slate-400">
            Shared by: {row.sharedByLabel}
          </span>
        ) : row.activity?.isSharedAcrossDeliverables && !row.sharedByLabel ? (
          <span
            className="truncate text-[10px] leading-tight text-cyan-700 dark:text-cyan-400"
            title={(row.activity.linkedDeliverables ?? []).map((d) => d.name).join(", ")}
          >
            Shared
          </span>
        ) : null}
      </span>
      <ScheduleEditableCell
        value={bestDurValue}
        editable={rowEditable}
        active={isEditing("bestDur")}
        align="right"
        mono
        width={COLS[3].w}
        title="Best duration (days)"
        onActivate={() => props.onStartEdit(row.key, "bestDur")}
        onCancel={props.onCancelEdit}
        onCommit={(v) => props.onSave(row, "bestDur", v)}
        validate={(v) => {
          const n = parseInt(v, 10);
          if (!Number.isInteger(n) || n < 1) return "Duration must be a positive integer";
          return null;
        }}
      />
      <ScheduleEditableCell
        value={likelyDurValue}
        editable={rowEditable}
        active={isEditing("likelyDur")}
        align="right"
        mono
        width={COLS[4].w}
        title="Likely duration (days)"
        onActivate={() => props.onStartEdit(row.key, "likelyDur")}
        onCancel={props.onCancelEdit}
        onCommit={(v) => props.onSave(row, "likelyDur", v)}
        validate={(v) => {
          const n = parseInt(v, 10);
          if (!Number.isInteger(n) || n < 1) return "Duration must be a positive integer";
          return null;
        }}
      />
      <span
        className={cn(
          "shrink-0 px-1 text-right font-mono tabular-nums",
          (cpm?.totalFloat ?? 0) < 0 && "font-semibold text-red-600 dark:text-red-400"
        )}
        style={{ width: COLS[5].w }}
      >
        {cpm?.totalFloat != null ? cpm.totalFloat : "—"}
      </span>
      <span className="shrink-0 px-1" style={{ width: COLS[6].w }}>
        {isCritical ? <CriticalActivityBadge /> : null}
      </span>
      <span className="shrink-0 px-1 text-right tabular-nums text-slate-500" style={{ width: COLS[7].w }}>
        {row.resourceCount ?? 0}
      </span>
      <span className="shrink-0 truncate px-1 text-slate-500" style={{ width: COLS[8].w }} title={row.relSummary}>
        {predTypes[0] ? (
          <span className="inline-flex items-center gap-0.5">
            <RelationshipTypeBadge type={predTypes[0].relationshipType} />
            {predTypes[0].lag ? <span className="text-[10px]">+{predTypes[0].lag}</span> : null}
          </span>
        ) : (
          relPreview
        )}
      </span>
    </div>
  );
}

export function ScheduleGrid(props: {
  rows: WorkspaceRow[];
  collapse: {
    fragnets: Record<string, boolean>;
    deliverables: Record<string, boolean>;
    sharedGroups: Record<string, boolean>;
    sharedActivities: Record<string, boolean>;
  };
  diagnosticsByActivity: Map<string, RowDiagnostic[]>;
  selectedNodeId: string | null;
  logicPredNodeId: string;
  logicSuccNodeId: string;
  hoveredNodeId: string | null;
  onSelectSuccessor: (id: string | null, fragnetId: string) => void;
  scrollTop: number;
  canEdit?: boolean;
  scenario?: "best" | "likely";
  savingCanonicalId?: string | null;
  onSaveActivity?: (canonicalId: string, patch: ScheduleActivityPatch) => Promise<void>;
  onScrollTop: (n: number) => void;
  onSelect: (id: string | null, fragnetId: string) => void;
  onHover: (id: string | null) => void;
  onToggleFragnet: (id: string) => void;
  onToggleDeliverable: (id: string) => void;
  onToggleSharedGroup: (fragnetId: string) => void;
  onToggleSharedActivity: (activityId: string) => void;
  deliverableIntelById?: Map<string, DeliverableStatusSnapshot>;
  onDeliverableIntelClick?: (deliverableId: string, deliverableName: string) => void;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const viewportH = useViewportHeight(viewportRef);
  const [editing, setEditing] = useState<{ rowKey: string; field: ScheduleEditField } | null>(null);

  const canEdit = props.canEdit ?? false;

  const handleSave = useCallback(
    async (row: WorkspaceRow, field: ScheduleEditField, value: string) => {
      setEditing(null);
      if (!row.activity || !props.onSaveActivity) return;
      const canonicalId = cpmLookupActivityId(row.activity);
      const patch: ScheduleActivityPatch = {};
      if (field === "code") patch.activityCode = value.trim();
      if (field === "name") patch.name = value.trim();
      if (field === "bestDur" || field === "likelyDur") {
        const n = parseInt(value, 10);
        if (field === "bestDur") patch.bestDuration = n;
        else patch.likelyDuration = n;
      }
      await props.onSaveActivity(canonicalId, patch);
    },
    [props.onSaveActivity]
  );

  useEffect(() => {
    const el = bodyRef.current;
    if (el && Math.abs(el.scrollTop - props.scrollTop) > 1) {
      el.scrollTop = props.scrollTop;
    }
  }, [props.scrollTop]);

  const onScroll = useCallback(() => {
    const el = bodyRef.current;
    if (el) props.onScrollTop(el.scrollTop);
  }, [props.onScrollTop]);

  const { start, end } = useMemo(
    () => visibleRowRange(props.scrollTop, viewportH, ROW_HEIGHT, props.rows.length),
    [props.scrollTop, viewportH, props.rows.length]
  );

  const slice = props.rows.slice(start, end);
  const padTop = start * ROW_HEIGHT;
  const padBottom = Math.max(0, (props.rows.length - end) * ROW_HEIGHT);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden border-r border-slate-300 dark:border-slate-600">
      <div
        className="sticky top-0 z-20 flex shrink-0 border-b border-slate-300 bg-slate-100 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-400"
        style={{ height: HEADER_HEIGHT, minWidth: gridMinWidth }}
      >
        {COLS.map((c) => (
          <span
            key={c.key}
            className={cn(
              "shrink-0 truncate px-1 py-2",
              c.key === "best" || c.key === "likely" || c.key === "tf" || c.key === "res" ? "text-right" : ""
            )}
            style={{ width: c.w }}
          >
            {c.label}
          </span>
        ))}
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-hidden">
        <div ref={bodyRef} className="h-full overflow-auto" onScroll={onScroll}>
          <div style={{ minWidth: gridMinWidth }}>
            <div style={{ height: padTop }} />
            {slice.map((row) => {
              const canonicalId = row.activity ? cpmLookupActivityId(row.activity) : null;
              const nodeId = row.scheduleNodeId ?? row.activityId ?? null;
              return (
                <GridRow
                  key={row.key}
                  row={row}
                  selected={nodeId != null && nodeId === props.selectedNodeId}
                  hovered={nodeId != null && nodeId === props.hoveredNodeId}
                  isLogicPred={nodeId != null && nodeId === props.logicPredNodeId}
                  isLogicSucc={nodeId != null && nodeId === props.logicSuccNodeId}
                  onSelectSuccessor={props.onSelectSuccessor}
                  diagnostics={
                    canonicalId ? props.diagnosticsByActivity.get(canonicalId) ?? [] : []
                  }
                  canEdit={canEdit}
                  saving={canonicalId != null && props.savingCanonicalId === canonicalId}
                  editing={editing}
                  onStartEdit={(rowKey, field) => setEditing({ rowKey, field })}
                  onCancelEdit={() => setEditing(null)}
                  onSave={handleSave}
                  onSelect={props.onSelect}
                  onHover={props.onHover}
                  onToggleFragnet={props.onToggleFragnet}
                  onToggleDeliverable={props.onToggleDeliverable}
                  onToggleSharedGroup={props.onToggleSharedGroup}
                  onToggleSharedActivity={props.onToggleSharedActivity}
                  fragnetOpen={props.collapse.fragnets[row.fragnetId] ?? true}
                  deliverableOpen={
                    row.deliverableId ? (props.collapse.deliverables[row.deliverableId] ?? true) : true
                  }
                  sharedGroupOpen={props.collapse.sharedGroups[row.fragnetId] ?? true}
                  sharedActivityOpen={
                    row.activityId ? (props.collapse.sharedActivities[row.activityId] ?? true) : true
                  }
                  deliverableIntel={
                    row.deliverableId ? props.deliverableIntelById?.get(row.deliverableId) : undefined
                  }
                  onDeliverableIntelClick={
                    row.deliverableId
                      ? () =>
                          props.onDeliverableIntelClick?.(row.deliverableId!, row.label)
                      : undefined
                  }
                />
              );
            })}
            <div style={{ height: padBottom }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function useViewportHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  const [h, setH] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, [ref]);
  return h;
}
