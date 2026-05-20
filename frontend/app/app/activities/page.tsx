"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Unlink, ListOrdered } from "lucide-react";
import { ActivityOwnershipBadge } from "@/components/schedule/activity-ownership-badge";
import { ActivityBulkActionsBar } from "@/components/activities/ActivityBulkActionsBar";
import { ActivityListToolbar } from "@/components/activities/ActivityListToolbar";
import { ActivityRelationshipsPanel } from "@/components/activities/ActivityRelationshipsPanel";
import { ActivityDefinitionForm } from "@/components/activities/ActivityDefinitionForm";
import {
  DEFAULT_ACTIVITY_FILTERS,
  filterActivities,
  type ActivityListFilters,
} from "@/lib/activity-list-filters";
import { activityListCostPreview } from "@/lib/activity-row-metrics";
import { buildRelationshipAdjacency } from "@/lib/schedule-relationship-health";
import {
  buildActivityCodePayload,
  buildDeliverableActivityP6FormMap,
  emptyP6FormMap,
  validateActivityDefinitionFields,
} from "@/lib/activity-form-utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  standardsApi,
  fragnetsApi,
  deliverablesApi,
  activitiesApi,
  activityCodeTypesApi,
  relationshipsApi,
  assuranceNotesApi,
  rateCardApi,
  type Standard,
  type Fragnet,
  type Activity,
  type ActivityCodeType,
  type Relationship,
  type AssuranceNote,
  type RelationshipType,
  type RateCardEntry,
  type Deliverable,
  getApiErrorMessage,
} from "@/lib/api";
import {
  ResourceAssignmentsEditor,
  draftsToPayload,
  storedToDrafts,
  type ResourceAssignmentDraft,
} from "@/components/resource-assignments-editor";
import { cn } from "@/lib/utils";
import { useProject } from "@/contexts/project-context";
import { hasPermission } from "@/lib/project-permissions";
import { detectRelationshipCycles, validateFragnetRelationships } from "@/lib/schedule-validation";

export default function ActivitiesPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayCreate = hasPermission(selectedProjectRole, "activity", "create");
  const mayEditByRole = hasPermission(selectedProjectRole, "activity", "update");
  const mayDeleteByRole = hasPermission(selectedProjectRole, "activity", "delete");
  const mayEditP6Codes = hasPermission(selectedProjectRole, "activityCode", "update");
  const mayDeleteRelationshipByRole = hasPermission(selectedProjectRole, "relationship", "delete");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState<string>("");
  const [fragnets, setFragnets] = useState<Fragnet[]>([]);
  const [selectedFragnetId, setSelectedFragnetId] = useState<string>("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [assuranceNotes, setAssuranceNotes] = useState<AssuranceNote[]>([]);
  const [loadingStandards, setLoadingStandards] = useState(true);
  const [loadingFragnets, setLoadingFragnets] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [tplCode, setTplCode] = useState("");
  const [tplName, setTplName] = useState("");
  const [tplBest, setTplBest] = useState("1");
  const [tplLikely, setTplLikely] = useState("1");
  const [tplResourceDrafts, setTplResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [tplP6Codes, setTplP6Codes] = useState<Record<string, string>>({});
  const [editId, setEditId] = useState<string | null>(null);
  const [formActivityCode, setFormActivityCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formBestDuration, setFormBestDuration] = useState("");
  const [formLikelyDuration, setFormLikelyDuration] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [formDeliverableId, setFormDeliverableId] = useState<string>("");
  const [formAssuranceNoteId, setFormAssuranceNoteId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingRelId, setDeletingRelId] = useState<string | null>(null);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [codeTypes, setCodeTypes] = useState<ActivityCodeType[]>([]);
  const [formP6Codes, setFormP6Codes] = useState<Record<string, string>>({});
  /** Bumps when opening the edit dialog so P6 fields re-merge after code types / deliverables load. */
  const [p6EditEpoch, setP6EditEpoch] = useState(0);
  const [listFilters, setListFilters] = useState<ActivityListFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const fetchCodeTypes = async () => {
    if (!selectedProjectId) {
      setCodeTypes([]);
      return;
    }
    try {
      const { data } = await activityCodeTypesApi.list(selectedProjectId);
      setCodeTypes(data);
    } catch {
      setCodeTypes([]);
    }
  };

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

  const fetchActivities = async () => {
    if (!selectedFragnetId) {
      setActivities([]);
      return;
    }
    setLoadingActivities(true);
    try {
      const { data } = await activitiesApi.listByFragnet(selectedFragnetId);
      setActivities(data);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load activities");
      setActivities([]);
    } finally {
      setLoadingActivities(false);
    }
  };

  const fetchDeliverables = async () => {
    if (!selectedProjectId || !selectedFragnetId) {
      setDeliverables([]);
      setFormDeliverableId("");
      return;
    }
    setLoadingDeliverables(true);
    try {
      const { data } = await deliverablesApi.list(selectedProjectId, selectedFragnetId);
      setDeliverables(data);
      // Auto-select first deliverable if none chosen.
      if (!formDeliverableId) {
        setFormDeliverableId(data[0]?.id ?? "");
      } else if (data.length > 0 && !data.some((d) => d.id === formDeliverableId)) {
        setFormDeliverableId(data[0]!.id);
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load deliverables");
      setDeliverables([]);
      setFormDeliverableId("");
    } finally {
      setLoadingDeliverables(false);
    }
  };

  const fetchRelationships = async () => {
    if (!selectedFragnetId) {
      setRelationships([]);
      return;
    }
    setLoadingRelationships(true);
    try {
      const { data } = await relationshipsApi.listByFragnet(selectedFragnetId);
      setRelationships(data);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load relationships");
      setRelationships([]);
    } finally {
      setLoadingRelationships(false);
    }
  };

  const fetchAssuranceNotes = async () => {
    if (!selectedStandardId) {
      setAssuranceNotes([]);
      return;
    }
    try {
      const { data } = await assuranceNotesApi.listByStandard(selectedStandardId);
      setAssuranceNotes(data);
    } catch {
      setAssuranceNotes([]);
    }
  };

  useEffect(() => {
    fetchCodeTypes();
  }, [selectedProjectId]);

  useEffect(() => {
    fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await rateCardApi.get();
        setRateCardEntries(data.entries ?? []);
      } catch {
        setRateCardEntries(null);
      }
    })();
  }, []);

  useEffect(() => {
    fetchFragnets();
  }, [selectedStandardId]);

  useEffect(() => {
    fetchActivities();
    fetchRelationships();
    fetchAssuranceNotes();
    fetchDeliverables();
  }, [selectedFragnetId, selectedStandardId]);

  /** Keep P6 selects aligned when code types or deliverables finish loading after open; merge deliverable-level codes. */
  useEffect(() => {
    if (!editId || codeTypes.length === 0) return;
    const a = activities.find((x) => x.id === editId);
    if (!a) return;
    if (a.deliverableId && !deliverables.some((d) => d.id === a.deliverableId)) return;
    const d = a.deliverableId ? deliverables.find((x) => x.id === a.deliverableId) : undefined;
    setFormP6Codes(
      buildDeliverableActivityP6FormMap(a.activityCodeAssignments, d?.activityCodeAssignments, codeTypes)
    );
  }, [editId, codeTypes, deliverables, p6EditEpoch]);

  const resetActivityForm = () => {
    setFormActivityCode("");
    setFormName("");
    setFormBestDuration("");
    setFormLikelyDuration("");
    setFormDeliverableId(deliverables[0]?.id ?? "");
    setFormAssuranceNoteId("");
    setFormResourceDrafts([]);
    setFormP6Codes({});
    setEditId(null);
    setCreateOpen(false);
  };

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateActivityDefinitionFields({
      scope: "deliverable",
      deliverableId: formDeliverableId,
      activityCode: formActivityCode,
      name: formName,
      bestDuration: formBestDuration,
      likelyDuration: formLikelyDuration,
    });
    if (!selectedFragnetId || err) {
      toast.error(err || "Select a fragnet");
      return;
    }
    const best = parseInt(formBestDuration, 10);
    const likely = parseInt(formLikelyDuration, 10);
    setSubmitting(true);
    try {
      await activitiesApi.create({
        fragnetId: selectedFragnetId,
        deliverableId: formDeliverableId,
        activityCode: formActivityCode.trim(),
        name: formName.trim(),
        bestDuration: best,
        likelyDuration: likely,
        assuranceNoteId: formAssuranceNoteId || undefined,
        assignedResources: draftsToPayload(formResourceDrafts),
        activityCodeByTypeId: buildActivityCodePayload(formP6Codes, codeTypes, "create", mayEditP6Codes),
      });
      toast.success("Activity created");
      resetActivityForm();
      await fetchActivities();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create activity");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateDefaultActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateActivityDefinitionFields({
      scope: "default",
      activityCode: tplCode,
      name: tplName,
      bestDuration: tplBest,
      likelyDuration: tplLikely,
    });
    if (!selectedFragnetId || err) {
      toast.error(err || "Select a fragnet");
      return;
    }
    const best = parseInt(tplBest, 10);
    const likely = parseInt(tplLikely, 10);
    setSubmitting(true);
    try {
      await fragnetsApi.createActivityTemplate(selectedFragnetId, {
        templateCode: tplCode.trim(),
        name: tplName.trim(),
        bestDuration: best,
        likelyDuration: likely,
        assignedResources: draftsToPayload(tplResourceDrafts),
        activityCodeByTypeId: buildActivityCodePayload(tplP6Codes, codeTypes, "create", mayEditP6Codes),
      });
      toast.success("Default activity added to all deliverables in this fragnet");
      setTemplateOpen(false);
      setTplCode("");
      setTplName("");
      setTplResourceDrafts([]);
      setTplP6Codes(emptyP6FormMap(codeTypes));
      await fetchActivities();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to add default activity");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    const best = formBestDuration === "" ? undefined : parseInt(formBestDuration, 10);
    const likely = formLikelyDuration === "" ? undefined : parseInt(formLikelyDuration, 10);
    if (best !== undefined && (! Number.isInteger(best) || best < 1)) {
      toast.error("Best duration must be a positive integer");
      return;
    }
    if (likely !== undefined && (!Number.isInteger(likely) || likely < 1)) {
      toast.error("Likely duration must be a positive integer");
      return;
    }
    setSubmitting(true);
    try {
      await activitiesApi.update(editId, {
        name: formName.trim() || undefined,
        deliverableId: formDeliverableId || undefined,
        bestDuration: best,
        likelyDuration: likely,
        assuranceNoteId: formAssuranceNoteId || null,
        assignedResources: draftsToPayload(formResourceDrafts),
        activityCodeByTypeId: buildActivityCodePayload(formP6Codes, codeTypes, "update", mayEditP6Codes),
      });
      toast.success("Activity updated");
      resetActivityForm();
      await fetchActivities();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update activity");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDetachFromTemplate = async (id: string) => {
    try {
      await activitiesApi.detachFromTemplate(id);
      toast.success("Activity detached — no longer syncs from fragnet defaults");
      await fetchActivities();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to detach");
    }
  };

  const handleDeleteActivity = async (id: string) => {
    if (!confirm("Delete this activity? Relationships involving it will be removed.")) return;
    setDeletingId(id);
    try {
      await activitiesApi.delete(id);
      toast.success("Activity deleted");
      await fetchActivities();
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete activity");
    } finally {
      setDeletingId(null);
    }
  };

  const openEditActivity = (a: Activity) => {
    setEditId(a.id);
    setFormActivityCode(a.activityCode);
    setFormName(a.name);
    setFormBestDuration(String(a.bestDuration));
    setFormLikelyDuration(String(a.likelyDuration));
    setFormDeliverableId(a.deliverableId ?? "");
    setFormAssuranceNoteId(a.assuranceNoteId ?? "");
    setFormResourceDrafts(storedToDrafts(a.assignedResources));
    setFormP6Codes({});
    setP6EditEpoch((e) => e + 1);
  };

  const selectedStandard = standards.find((s) => s.id === selectedStandardId);
  const selectedFragnet = fragnets.find((f) => f.id === selectedFragnetId);

  const activityById = (id: string) => activities.find((a) => a.id === id);
  const activityLabel = (id: string) => {
    const a = activityById(id);
    return a ? `${a.activityCode} — ${a.name}` : id;
  };

  const { predCount, succCount } = useMemo(
    () => buildRelationshipAdjacency(activities, relationships),
    [activities, relationships]
  );

  const filteredActivities = useMemo(
    () => filterActivities(activities, relationships, deliverables, listFilters, codeTypes),
    [activities, relationships, deliverables, listFilters, codeTypes]
  );

  const relValidationCount = useMemo(
    () => validateFragnetRelationships(activities, relationships).filter((i) => i.severity === "critical").length,
    [activities, relationships]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === filteredActivities.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredActivities.map((a) => a.id)));
  };

  const handleBulkDetach = async () => {
    const ids = [...selectedIds].filter((id) => {
      const a = activityById(id);
      return a?.isInherited && !a.detachedFromTemplate;
    });
    if (ids.length === 0) {
      toast.error("No inherited activities selected");
      return;
    }
    if (!confirm(`Detach ${ids.length} activit${ids.length === 1 ? "y" : "ies"} from fragnet defaults?`)) return;
    setBulkBusy(true);
    try {
      for (const id of ids) await activitiesApi.detachFromTemplate(id);
      toast.success(`Detached ${ids.length} activities`);
      setSelectedIds(new Set());
      await fetchActivities();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Bulk detach failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`Delete ${ids.length} activit${ids.length === 1 ? "y" : "ies"}?`)) return;
    setBulkBusy(true);
    try {
      for (const id of ids) await activitiesApi.delete(id);
      toast.success(`Deleted ${ids.length} activities`);
      setSelectedIds(new Set());
      await fetchActivities();
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Bulk delete failed");
    } finally {
      setBulkBusy(false);
    }
  };

  const handleApplyDefaults = async () => {
    if (!selectedFragnetId) return;
    setSubmitting(true);
    try {
      const { data } = await fragnetsApi.syncActivityTemplates(selectedFragnetId);
      toast.success(`Applied defaults: ${data.updated} updated, ${data.activities} new activities`);
      await fetchActivities();
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Apply failed");
    } finally {
      setSubmitting(false);
    }
  };

  const createRelationship = async (data: {
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: RelationshipType;
    lag: number;
  }) => {
    if (!selectedFragnetId) return;
    const dup = relationships.some(
      (r) =>
        r.predecessorActivityId === data.predecessorActivityId &&
        r.successorActivityId === data.successorActivityId &&
        r.relationshipType === data.relationshipType
    );
    if (dup) {
      toast.error("This relationship already exists");
      return;
    }
    const hypothetical = [
      ...relationships,
      {
        id: "new",
        fragnetId: selectedFragnetId,
        ...data,
      },
    ];
    if (detectRelationshipCycles(activities, hypothetical).length > 0) {
      toast.error("This link would create a circular dependency");
      return;
    }
    setSubmitting(true);
    try {
      await relationshipsApi.create({ fragnetId: selectedFragnetId, ...data });
      toast.success("Relationship created");
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create relationship");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const updateRelationship = async (
    id: string,
    data: { relationshipType?: RelationshipType; lag?: number }
  ) => {
    setSubmitting(true);
    try {
      await relationshipsApi.update(id, data);
      toast.success("Relationship updated");
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update relationship");
      throw err;
    } finally {
      setSubmitting(false);
    }
  };

  const p6Snippet = (a: Activity) => {
    const d = a.deliverableId ? deliverables.find((x) => x.id === a.deliverableId) : undefined;
    const byType = new Map<string, { type: { name: string }; code: { name: string } }>();
    for (const row of d?.activityCodeAssignments ?? []) {
      byType.set(row.typeId, { type: row.type, code: row.code });
    }
    for (const row of a.activityCodeAssignments ?? []) {
      byType.set(row.typeId, { type: row.type, code: row.code });
    }
    if (byType.size === 0) return "—";
    return [...byType.values()].map((r) => `${r.type.name}: ${r.code.name}`).join("; ");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Activities</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Activities and relationships within fragnets.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select standard and fragnet</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">Choose a standard, then a fragnet to manage activities.</p>
        </CardHeader>
        <CardContent>
          {loadingStandards ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading standards…
            </div>
          ) : standards.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No standards yet. Create one on the Standards page first.</p>
          ) : (
            <div className="flex flex-wrap gap-4">
              <div className="grid gap-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Standard</label>
                <select
                  value={selectedStandardId}
                  onChange={(e) => setSelectedStandardId(e.target.value)}
                  className={cn(
                    "flex h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
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
                  disabled={!selectedStandardId || loadingFragnets || fragnets.length === 0}
                  className={cn(
                    "flex h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                    "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50"
                  )}
                >
                  {fragnets.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                  {fragnets.length === 0 && <option value="">No fragnets</option>}
                </select>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {selectedFragnetId && (
        <>
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <CardTitle className="truncate">Activities — {selectedFragnet?.name}</CardTitle>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {activities.length} materialized activit{activities.length === 1 ? "y" : "ies"} on this fragnet
                </p>
              </div>
              {mayCreate ? (
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Dialog
                    open={templateOpen}
                    onOpenChange={(o) => {
                      setTemplateOpen(o);
                      if (!o) {
                        setTplCode("");
                        setTplName("");
                        setTplResourceDrafts([]);
                        setTplP6Codes(emptyP6FormMap(codeTypes));
                      } else if (codeTypes.length > 0) {
                        setTplP6Codes(emptyP6FormMap(codeTypes));
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button type="button" variant="outline">
                        <ListOrdered className="h-4 w-4" /> Add default activity
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[720px]">
                      <form onSubmit={handleCreateDefaultActivity} className="min-w-0">
                        <DialogHeader className="space-y-2 pb-2">
                          <DialogTitle>Add default activity</DialogTitle>
                          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            Standard activity every deliverable in this fragnet receives automatically.
                          </p>
                        </DialogHeader>
                        <ActivityDefinitionForm
                          scope="default"
                          formActivityCode={tplCode}
                          onActivityCode={setTplCode}
                          formName={tplName}
                          onName={setTplName}
                          formBestDuration={tplBest}
                          onBestDuration={setTplBest}
                          formLikelyDuration={tplLikely}
                          onLikelyDuration={setTplLikely}
                          mayEditP6Codes={mayEditP6Codes}
                          codeTypes={codeTypes}
                          formP6Codes={tplP6Codes}
                          onP6Code={(typeId, codeId) => setTplP6Codes((prev) => ({ ...prev, [typeId]: codeId }))}
                          rateCardEntries={rateCardEntries}
                          formResourceDrafts={tplResourceDrafts}
                          onResourceDrafts={setTplResourceDrafts}
                          submitting={submitting}
                        />
                        <DialogFooter className="gap-2 pt-4">
                          <Button type="button" variant="outline" onClick={() => setTemplateOpen(false)}>
                            Cancel
                          </Button>
                          <Button type="submit" disabled={submitting}>
                            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                            Add default activity
                          </Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                  <Dialog
                    open={createOpen}
                    onOpenChange={(o) => {
                      setCreateOpen(o);
                      if (o) {
                        setFormResourceDrafts([]);
                        setFormDeliverableId((prev) => prev || deliverables[0]?.id || "");
                      } else resetActivityForm();
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button type="button">
                        <Plus className="h-4 w-4" /> Add deliverable activity
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[720px]">
                      <form onSubmit={handleCreateActivity} className="min-w-0">
                        <DialogHeader className="space-y-2 pb-2">
                          <DialogTitle>Add deliverable activity</DialogTitle>
                          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                            Custom activity for one deliverable only — not shared across the fragnet.
                          </p>
                        </DialogHeader>
                        <ActivityDefinitionForm
                          scope="deliverable"
                          deliverables={deliverables}
                          loadingDeliverables={loadingDeliverables}
                          formDeliverableId={formDeliverableId}
                          onDeliverableId={setFormDeliverableId}
                          formActivityCode={formActivityCode}
                          onActivityCode={setFormActivityCode}
                          formName={formName}
                          onName={setFormName}
                          formBestDuration={formBestDuration}
                          onBestDuration={setFormBestDuration}
                          formLikelyDuration={formLikelyDuration}
                          onLikelyDuration={setFormLikelyDuration}
                          assuranceNotes={assuranceNotes}
                          formAssuranceNoteId={formAssuranceNoteId}
                          onAssuranceNoteId={setFormAssuranceNoteId}
                          mayEditP6Codes={mayEditP6Codes}
                          codeTypes={codeTypes}
                          formP6Codes={formP6Codes}
                          onP6Code={(typeId, codeId) => setFormP6Codes((prev) => ({ ...prev, [typeId]: codeId }))}
                          rateCardEntries={rateCardEntries}
                          formResourceDrafts={formResourceDrafts}
                          onResourceDrafts={setFormResourceDrafts}
                          submitting={submitting}
                        />
                        <DialogFooter className="gap-2 pt-4">
                          <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                          <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create activity</Button>
                        </DialogFooter>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-4">
              {activities.length > 0 && (
                <>
                  <ActivityListToolbar
                    filters={listFilters}
                    onChange={setListFilters}
                    deliverables={deliverables}
                    codeTypes={codeTypes}
                    totalCount={activities.length}
                    filteredCount={filteredActivities.length}
                  />
                  <ActivityBulkActionsBar
                    selectedCount={selectedIds.size}
                    onClear={() => setSelectedIds(new Set())}
                    onBulkDetach={handleBulkDetach}
                    onBulkDelete={handleBulkDelete}
                    busy={bulkBusy}
                    canDetach={mayEditByRole}
                    canDelete={mayDeleteByRole}
                  />
                  {mayEditByRole && (
                    <Button type="button" variant="outline" size="sm" disabled={submitting} onClick={handleApplyDefaults}>
                      Apply default activities to deliverables
                    </Button>
                  )}
                  {relValidationCount > 0 && (
                    <p className="text-sm text-red-700 dark:text-red-300">
                      {relValidationCount} critical relationship issue{relValidationCount !== 1 ? "s" : ""} on this fragnet — review links below.
                    </p>
                  )}
                </>
              )}
              {loadingActivities ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
              ) : activities.length === 0 ? (
                <p className="py-8 text-center text-slate-500 dark:text-slate-400">No activities. Add one to get started.</p>
              ) : filteredActivities.length === 0 ? (
                <p className="py-8 text-center text-slate-500 dark:text-slate-400">No activities match filters.</p>
              ) : (
                <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={selectedIds.size === filteredActivities.length && filteredActivities.length > 0}
                          onChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Deliverable</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Links</TableHead>
                      <TableHead>P6 codes</TableHead>
                      <TableHead>Best</TableHead>
                      <TableHead>Likely</TableHead>
                      <TableHead>Cost (best)</TableHead>
                      <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActivities.map((a) => {
                      const cost = activityListCostPreview(a, rateCardEntries, "best");
                      const dName = deliverables.find((d) => d.id === a.deliverableId)?.name ?? "—";
                      const preds = predCount.get(a.id) ?? 0;
                      const succs = succCount.get(a.id) ?? 0;
                      return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <input
                            type="checkbox"
                            aria-label={`Select ${a.activityCode}`}
                            checked={selectedIds.has(a.id)}
                            onChange={() => toggleSelect(a.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{a.activityCode}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-sm text-slate-600 dark:text-slate-400" title={dName}>
                          {dName}
                        </TableCell>
                        <TableCell>
                          <ActivityOwnershipBadge activity={a} />
                          {a.isInherited && !a.detachedFromTemplate && (
                            <p className="mt-1 text-xs text-violet-600 dark:text-violet-400">Synced from fragnet default</p>
                          )}
                          {a.detachedFromTemplate && (
                            <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Detached — edits won&apos;t sync</p>
                          )}
                        </TableCell>
                        <TableCell>{a.name}</TableCell>
                        <TableCell className="text-xs tabular-nums text-slate-600 dark:text-slate-400">
                          {preds}P / {succs}S
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-slate-600 dark:text-slate-400" title={p6Snippet(a)}>
                          {p6Snippet(a)}
                        </TableCell>
                        <TableCell>{a.bestDuration}</TableCell>
                        <TableCell>{a.likelyDuration}</TableCell>
                        <TableCell className="text-sm tabular-nums text-slate-700 dark:text-slate-300">
                          {cost.totalCost > 0 ? `$${cost.totalCost.toLocaleString()}` : "—"}
                          {cost.missingRates > 0 && (
                            <span className="ml-1 text-xs text-amber-600">({cost.missingRates} unrated)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Dialog
                              open={editId === a.id}
                              onOpenChange={(o) => {
                                if (!o) resetActivityForm();
                              }}
                            >
                              <DialogTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="icon"
                                  type="button"
                                  onClick={() => openEditActivity(a)}
                                  disabled={!mayEditByRole}
                                  title={!mayEditByRole ? "No permission" : "Edit"}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="sm:max-w-[720px]">
                                <form onSubmit={handleUpdateActivity} className="min-w-0">
                                  <DialogHeader className="space-y-2 pb-2">
                                    <DialogTitle>Edit activity</DialogTitle>
                                  </DialogHeader>
                                  <ActivityDefinitionForm
                                    scope="deliverable"
                                    deliverables={deliverables}
                                    loadingDeliverables={loadingDeliverables}
                                    formDeliverableId={formDeliverableId}
                                    onDeliverableId={setFormDeliverableId}
                                    formActivityCode={formActivityCode}
                                    onActivityCode={setFormActivityCode}
                                    formName={formName}
                                    onName={setFormName}
                                    formBestDuration={formBestDuration}
                                    onBestDuration={setFormBestDuration}
                                    formLikelyDuration={formLikelyDuration}
                                    onLikelyDuration={setFormLikelyDuration}
                                    assuranceNotes={assuranceNotes}
                                    formAssuranceNoteId={formAssuranceNoteId}
                                    onAssuranceNoteId={setFormAssuranceNoteId}
                                    mayEditP6Codes={mayEditP6Codes}
                                    codeTypes={codeTypes}
                                    formP6Codes={formP6Codes}
                                    onP6Code={(typeId, codeId) => setFormP6Codes((prev) => ({ ...prev, [typeId]: codeId }))}
                                    rateCardEntries={rateCardEntries}
                                    formResourceDrafts={formResourceDrafts}
                                    onResourceDrafts={setFormResourceDrafts}
                                    submitting={submitting}
                                    lockActivityCode
                                  />
                                  <DialogFooter className="gap-2 pt-4">
                                    <Button type="button" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                                    <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
                                  </DialogFooter>
                                </form>
                              </DialogContent>
                            </Dialog>

                            {a.isInherited && !a.detachedFromTemplate && mayEditByRole && (
                              <Button
                                variant="outline"
                                size="icon"
                                type="button"
                                onClick={() => handleDetachFromTemplate(a.id)}
                                title="Detach from fragnet defaults"
                              >
                                <Unlink className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleDeleteActivity(a.id)}
                              disabled={!mayDeleteByRole || deletingId === a.id}
                              title={!mayDeleteByRole ? "No permission" : "Delete"}
                            >
                              {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                    })}
                  </TableBody>
                </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <ActivityRelationshipsPanel
            activities={activities}
            relationships={relationships}
            loading={loadingRelationships}
            mayEdit={mayEditByRole}
            mayDelete={mayDeleteRelationshipByRole}
            submitting={submitting}
            onCreate={createRelationship}
            onUpdate={updateRelationship}
            onDelete={async (id) => {
              if (!confirm("Remove this relationship?")) return;
              setDeletingRelId(id);
              try {
                await relationshipsApi.delete(id);
                toast.success("Relationship removed");
                await fetchRelationships();
              } catch (err: unknown) {
                toast.error(getApiErrorMessage(err) || "Failed to delete relationship");
              } finally {
                setDeletingRelId(null);
              }
            }}
            activityLabel={activityLabel}
          />
        </>
      )}
    </div>
  );
}
