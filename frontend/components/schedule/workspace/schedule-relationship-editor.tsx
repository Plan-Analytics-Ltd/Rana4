"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { fieldClass } from "@/components/schedule/form-section";
import {
  activitiesApi,
  deliverableActivityRelationshipsApi,
  deliverableRelationshipsApi,
  getApiErrorMessage,
  projectsApi,
  relationshipsApi,
  type RelationshipType,
  type ScheduleNetworkRelationship,
} from "@/lib/api";
import {
  deliverableIdFromScheduleNodeId,
  deliverableScheduleNodeId,
  isDeliverableScheduleNodeId,
} from "@/lib/schedule-node-ids";
import type { WorkspaceRow } from "@/lib/schedule-workspace-data";
import { cn } from "@/lib/utils";

const REL_TYPES: RelationshipType[] = ["FS", "SS", "FF", "SF"];

type ScheduleNodeOption = { id: string; label: string; group: "deliverable" | "activity" };

export function ScheduleRelationshipEditor(props: {
  rows: WorkspaceRow[];
  relationships: ScheduleNetworkRelationship[];
  projectId: string | null;
  fragnetId: string | null;
  predecessorId: string;
  onPredecessorIdChange: (id: string) => void;
  successorId?: string;
  onSuccessorIdChange?: (id: string) => void;
  canEdit: boolean;
  onCreated: () => void;
  className?: string;
}) {
  const {
    rows,
    relationships,
    projectId,
    fragnetId,
    predecessorId: predId,
    onPredecessorIdChange: setPredId,
    successorId: succIdProp,
    onSuccessorIdChange: setSuccIdProp,
    canEdit,
    onCreated,
    className,
  } = props;
  const [succIdLocal, setSuccIdLocal] = useState("");
  const succId = succIdProp ?? succIdLocal;
  const setSuccId = setSuccIdProp ?? setSuccIdLocal;
  const [relType, setRelType] = useState<RelationshipType>("FS");
  const [lag, setLag] = useState("0");
  const [busy, setBusy] = useState(false);

  const materializePreviewActivitiesForDeliverable = async (deliverableId: string) => {
    const previewRows = rows.filter(
      (r): r is WorkspaceRow & { kind: "activity"; activity: NonNullable<WorkspaceRow["activity"]>; code: string } =>
        r.kind === "activity" &&
        r.deliverableId === deliverableId &&
        Boolean(r.code) &&
        Boolean(r.activity?.isExpandedPerDeliverable)
    );
    if (previewRows.length === 0) return new Map<string, { id: string; fragnetId: string }>();

    const createdByCode = new Map<string, { id: string; fragnetId: string }>();
    for (const row of previewRows) {
      const activityCode = projectId
        ? (await projectsApi.getSuggestedActivityCode(projectId)).data.activityCode
        : row.code;
      const response = await activitiesApi.create({
        deliverableId,
        activityCode,
        name: row.label,
        bestDuration: row.bestDuration ?? row.activity.bestDuration,
        likelyDuration: row.likelyDuration ?? row.activity.likelyDuration,
        assignedResources: (row.activity.assignedResources ?? []).map((resource) => ({
          resourceType: resource.resourceType,
          resourceName: resource.resourceName,
          units: resource.units,
        })),
      });
      createdByCode.set(row.code, {
        id: response.data.id,
        fragnetId: response.data.fragnetId,
      });
    }

    for (const row of previewRows) {
      const successor = createdByCode.get(row.code);
      if (!successor) continue;
      for (const predecessorRel of row.activity.relationships.predecessors ?? []) {
        const predecessor = createdByCode.get(predecessorRel.activityCode);
        if (!predecessor || predecessor.id === successor.id) continue;
        await relationshipsApi.create({
          fragnetId: predecessor.fragnetId,
          predecessorActivityId: predecessor.id,
          successorActivityId: successor.id,
          relationshipType: predecessorRel.relationshipType,
          lag: predecessorRel.lag,
        });
      }
    }

    return createdByCode;
  };

  const resolveActivityNode = async (
    nodeId: string,
    materializedByDeliverable: Map<string, Map<string, { id: string; fragnetId: string }>>
  ): Promise<{ id: string; fragnetId: string } | null> => {
    const row = rows.find((r) => (r.scheduleNodeId ?? r.activityId) === nodeId);
    if (!row || row.kind !== "activity" || !row.activity) return null;
    if (!row.activity.isExpandedPerDeliverable) {
      return row.activityId ? { id: row.activityId, fragnetId: row.fragnetId } : null;
    }
    if (!row.deliverableId || !row.code) return null;

    let created = materializedByDeliverable.get(row.deliverableId);
    if (!created) {
      created = await materializePreviewActivitiesForDeliverable(row.deliverableId);
      materializedByDeliverable.set(row.deliverableId, created);
    }
    return created.get(row.code) ?? null;
  };

  const nodeOptions = useMemo(() => {
    const deliverables: ScheduleNodeOption[] = [];
    const activities: ScheduleNodeOption[] = [];
    const seenAct = new Set<string>();
    const fragnetLabelById = new Map(
      rows.filter((r) => r.kind === "fragnet").map((r) => [r.fragnetId, r.label] as const)
    );

    for (const r of rows) {
      const fragnetLabel = fragnetLabelById.get(r.fragnetId);
      if (r.kind === "deliverable" && r.deliverableId) {
        deliverables.push({
          id: deliverableScheduleNodeId(r.deliverableId),
          label: `${fragnetLabel ? `${fragnetLabel} · ` : ""}${r.label} (deliverable)`,
          group: "deliverable",
        });
      }
      if (r.kind === "activity" && r.activity) {
        const nodeId = r.scheduleNodeId ?? r.activityId;
        if (!nodeId || seenAct.has(nodeId)) continue;
        seenAct.add(nodeId);
        activities.push({
          id: nodeId,
          label: `${fragnetLabel ? `${fragnetLabel} · ` : ""}${r.code ?? nodeId} — ${r.label}${r.activity.isExpandedPerDeliverable ? " (workflow preview)" : ""}`,
          group: "activity",
        });
      }
    }
    deliverables.sort((a, b) => a.label.localeCompare(b.label));
    activities.sort((a, b) => a.label.localeCompare(b.label));
    return { deliverables, activities };
  }, [rows]);

  const deliverableLinkCount = useMemo(
    () => relationships.filter((r) => isDeliverableScheduleNodeId(r.predecessorActivityId)).length,
    [relationships]
  );

  const submit = async () => {
    if (!predId || !succId) {
      toast.error("Select predecessor and successor");
      return;
    }
    if (predId === succId) {
      toast.error("Predecessor and successor must differ");
      return;
    }
    const lagN = parseInt(lag, 10);
    if (!Number.isInteger(lagN)) {
      toast.error("Lag must be a whole number of days");
      return;
    }
    setBusy(true);
    try {
      const predIsDel = isDeliverableScheduleNodeId(predId);
      const succIsDel = isDeliverableScheduleNodeId(succId);
      const materializedByDeliverable = new Map<string, Map<string, { id: string; fragnetId: string }>>();
      const predRow = rows.find((r) => (r.scheduleNodeId ?? r.activityId) === predId);
      if ((!predIsDel || !succIsDel) && !fragnetId) {
        toast.error("Select a fragnet before linking activities");
        return;
      }
      const activeFragnetId = fragnetId;
      if (predIsDel && succIsDel) {
        await deliverableRelationshipsApi.create({
          predecessorDeliverableId: deliverableIdFromScheduleNodeId(predId),
          successorDeliverableId: deliverableIdFromScheduleNodeId(succId),
          relationshipType: relType,
          lag: lagN,
        });
      } else if (!predIsDel && !succIsDel) {
        const predecessor = await resolveActivityNode(predId, materializedByDeliverable);
        const successor = await resolveActivityNode(succId, materializedByDeliverable);
        if (!predecessor || !successor) {
          toast.error("Could not resolve one of the selected activities");
          return;
        }
        await relationshipsApi.create({
          fragnetId: predecessor.fragnetId || activeFragnetId!,
          predecessorActivityId: predecessor.id,
          successorActivityId: successor.id,
          relationshipType: relType,
          lag: lagN,
        });
      } else if (predIsDel && !succIsDel) {
        const predDelId = deliverableIdFromScheduleNodeId(predId);
        const successor = await resolveActivityNode(succId, materializedByDeliverable);
        if (!successor) {
          toast.error("Could not resolve the selected successor activity");
          return;
        }
        await deliverableActivityRelationshipsApi.create({
          fragnetId: activeFragnetId!,
          predecessorDeliverableId: predDelId,
          successorActivityId: successor.id,
          relationshipType: relType,
          lag: lagN,
        });
      } else {
        const predecessor = await resolveActivityNode(predId, materializedByDeliverable);
        const succDelId = deliverableIdFromScheduleNodeId(succId);
        if (!predecessor) {
          toast.error("Could not resolve the selected predecessor activity");
          return;
        }
        const predDelId = predRow?.deliverableId;
        if (!predDelId) {
          toast.error("Could not resolve deliverable for predecessor activity");
          return;
        }
        if (predDelId === succDelId) {
          toast.error("Use deliverable → activity to link a summary task to its workflow steps");
          return;
        }
        await deliverableRelationshipsApi.create({
          fragnetId: activeFragnetId ?? undefined,
          predecessorDeliverableId: predDelId,
          successorDeliverableId: succDelId,
          relationshipType: relType,
          lag: lagN,
        });
      }
      toast.success("Link added");
      setSuccId("");
      setLag("0");
      onCreated();
    } catch (err) {
      toast.error(getApiErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const renderOptions = (items: ScheduleNodeOption[]) =>
    items.map((o) => (
      <option key={o.id} value={o.id}>
        {o.label}
      </option>
    ));

  return (
    <div className={cn("min-w-0 flex-1", className)}>
      <div className="flex flex-wrap items-end gap-1.5">
        <span className="shrink-0 pb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-400">
          Add logic · {relationships.length}
          {deliverableLinkCount > 0 ? ` · ${deliverableLinkCount} del` : ""}
          {canEdit ? (
            <span className="ml-1 font-normal normal-case text-slate-500">· click row = pred · double-click = succ</span>
          ) : null}
        </span>
        <label className="grid min-w-[160px] flex-1 gap-0.5 text-[10px] font-medium text-slate-500">
          Predecessor
          <select
            className={fieldClass}
            value={predId}
            disabled={!canEdit}
            onChange={(e) => setPredId(e.target.value)}
          >
            <option value="">Select…</option>
            {nodeOptions.deliverables.length > 0 ? (
              <optgroup label="Deliverables (summary tasks)">
                {renderOptions(nodeOptions.deliverables)}
              </optgroup>
            ) : null}
            {nodeOptions.activities.length > 0 ? (
              <optgroup label="Activities">
                {renderOptions(nodeOptions.activities)}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="grid w-16 gap-0.5 text-[10px] font-medium text-slate-500">
          Type
          <select
            className={fieldClass}
            value={relType}
            disabled={!canEdit}
            onChange={(e) => setRelType(e.target.value as RelationshipType)}
          >
            {REL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="grid min-w-[160px] flex-1 gap-0.5 text-[10px] font-medium text-slate-500">
          Successor
          <select
            className={fieldClass}
            value={succId}
            disabled={!canEdit}
            onChange={(e) => setSuccId(e.target.value)}
          >
            <option value="">Select…</option>
            {nodeOptions.deliverables.length > 0 ? (
              <optgroup label="Deliverables (summary tasks)">
                {renderOptions(nodeOptions.deliverables)}
              </optgroup>
            ) : null}
            {nodeOptions.activities.length > 0 ? (
              <optgroup label="Activities">
                {renderOptions(nodeOptions.activities)}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="grid w-14 gap-0.5 text-[10px] font-medium text-slate-500">
          Lag
          <input
            className={fieldClass}
            value={lag}
            disabled={!canEdit}
            onChange={(e) => setLag(e.target.value)}
          />
        </label>
        <Button
          type="button"
          size="sm"
          className="h-9"
          disabled={!canEdit || busy}
          onClick={() => void submit()}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Add
        </Button>
      </div>
    </div>
  );
}
