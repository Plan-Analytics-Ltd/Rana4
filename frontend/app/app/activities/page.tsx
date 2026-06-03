"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import { ActivityBulkActionsBar } from "@/components/activities/ActivityBulkActionsBar";
import { ActivityTemplatesPanel } from "@/components/activities/ActivityTemplatesPanel";
import { showActivityDevTools } from "@/lib/dev-flags";
import { ActivityListToolbar } from "@/components/activities/ActivityListToolbar";
import { ActivityDefinitionForm } from "@/components/activities/ActivityDefinitionForm";
import { ActivityRelationshipsPanel } from "@/components/activities/ActivityRelationshipsPanel";
import {
  DEFAULT_ACTIVITY_FILTERS,
  filterActivities,
  type ActivityListFilters,
} from "@/lib/activity-list-filters";
import { buildRelationshipAdjacency } from "@/lib/schedule-relationship-health";
import {
  buildActivityCodePayload,
  buildDeliverableActivityP6FormMap,
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
  projectsApi,
  activityCodeTypesApi,
  relationshipsApi,
  deliverableActivityRelationshipsApi,
  activityToDeliverableRelationshipsApi,
  assuranceNotesApi,
  rateCardApi,
  type Standard,
  type Fragnet,
  type Activity,
  type ActivityCodeType,
  type AssuranceNote,
  type RateCardEntry,
  type Relationship,
  type RelationshipType,
  type DeliverableActivityRelationship,
  type ActivityToDeliverableRelationship,
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
import { useActivityCodeAvailability } from "@/lib/use-activity-code-availability";
import { useNextActivityCode } from "@/lib/use-next-activity-code";
import {
  PROJECT_LEVEL_LABEL,
  filterUserVisibleFragnets,
  filterUserVisibleStandards,
} from "@/lib/project-level-ui";

export default function ActivitiesPage() {
  const PROJECT_LEVEL_FRAGNET_ID = "__project_level_fragnet__";

  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayCreate = hasPermission(selectedProjectRole, "activity", "create");
  const mayEditByRole = hasPermission(selectedProjectRole, "activity", "update");
  const mayDeleteByRole = hasPermission(selectedProjectRole, "activity", "delete");
  const mayEditP6Codes = hasPermission(selectedProjectRole, "activityCode", "update");
  const mayEditRel = hasPermission(selectedProjectRole, "relationship", "update");
  const mayDeleteRel = hasPermission(selectedProjectRole, "relationship", "delete");

  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState<string>("");
  const [fragnets, setFragnets] = useState<Fragnet[]>([]);
  const [selectedFragnetId, setSelectedFragnetId] = useState<string>("");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [deliverableActivityRelationships, setDeliverableActivityRelationships] = useState<
    DeliverableActivityRelationship[]
  >([]);
  const [activityToDeliverableRelationships, setActivityToDeliverableRelationships] = useState<
    ActivityToDeliverableRelationship[]
  >([]);
  const [assuranceNotes, setAssuranceNotes] = useState<AssuranceNote[]>([]);
  const [loadingStandards, setLoadingStandards] = useState(true);
  const [loadingFragnets, setLoadingFragnets] = useState(false);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formActivityCode, setFormActivityCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formBestDuration, setFormBestDuration] = useState("");
  const [formLikelyDuration, setFormLikelyDuration] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [projectLevelContextFragnetId, setProjectLevelContextFragnetId] = useState<string | null>(null);
  const [formDeliverableId, setFormDeliverableId] = useState<string>("");
  const [formLinkedDeliverableIds, setFormLinkedDeliverableIds] = useState<string[]>([]);
  const [formIsSharedAcrossDeliverables, setFormIsSharedAcrossDeliverables] = useState(false);
  const [formAssuranceNoteId, setFormAssuranceNoteId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  const formDialogOpen = createOpen || editId != null;
  const isProjectLevelFragnetSelected = selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID;
  const activityCodeFragnetId =
    isProjectLevelFragnetSelected ? projectLevelContextFragnetId : selectedFragnetId || null;
  const { nextCode: nextAvailableId, loading: nextAvailableLoading } = useNextActivityCode(
    selectedProjectId,
    formDialogOpen,
    editId
  );
  const createCodeCheck = useActivityCodeAvailability(
    selectedProjectId,
    createOpen ? activityCodeFragnetId : null,
    createOpen ? formActivityCode : ""
  );
  const editCodeCheck = useActivityCodeAvailability(
    selectedProjectId,
    editId ? activityCodeFragnetId : null,
    editId ? formActivityCode : "",
    editId
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [codeTypes, setCodeTypes] = useState<ActivityCodeType[]>([]);
  const [formP6Codes, setFormP6Codes] = useState<Record<string, string>>({});
  const [p6EditEpoch, setP6EditEpoch] = useState(0);
  const [listFilters, setListFilters] = useState<ActivityListFilters>(DEFAULT_ACTIVITY_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [loadingRelationships, setLoadingRelationships] = useState(false);
  const [relSubmitting, setRelSubmitting] = useState(false);

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
        setSelectedFragnetId(PROJECT_LEVEL_FRAGNET_ID);
        return;
      }
      const { data } = await standardsApi.list(selectedProjectId);
      const options = filterUserVisibleStandards(data);
      setStandards(options);
      setSelectedStandardId((prev) =>
        prev && options.some((standard) => standard.id === prev) ? prev : options[0]?.id ?? ""
      );
      if (options.length === 0) {
        setSelectedFragnetId(PROJECT_LEVEL_FRAGNET_ID);
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load standards");
    } finally {
      setLoadingStandards(false);
    }
  };

  const fetchFragnets = async () => {
    if (!selectedProjectId || !selectedStandardId) {
      setFragnets([]);
      if (!selectedStandardId) setSelectedFragnetId(PROJECT_LEVEL_FRAGNET_ID);
      return;
    }
    setLoadingFragnets(true);
    try {
      const { data } = await fragnetsApi.listByStandard(selectedStandardId);
      const options = filterUserVisibleFragnets(data);
      setFragnets(options);
      if (!isProjectLevelFragnetSelected) {
        setSelectedFragnetId((prev) =>
          prev && options.some((fragnet) => fragnet.id === prev) ? prev : options[0]?.id ?? ""
        );
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load fragnets");
      setFragnets([]);
    } finally {
      setLoadingFragnets(false);
    }
  };

  const syncDeliverables = (data: Deliverable[]) => {
    setDeliverables(data);
    const nextPrimary =
      !formDeliverableId || !data.some((d) => d.id === formDeliverableId) ? (data[0]?.id ?? "") : formDeliverableId;
    setFormDeliverableId(nextPrimary);
    setFormLinkedDeliverableIds((prev) =>
      [...new Set([nextPrimary, ...prev])].filter((id) => data.some((d) => d.id === id))
    );
  };

  const fetchProjectLevelContext = async () => {
    if (!selectedProjectId) {
      setActivities([]);
      setRelationships([]);
      setAssuranceNotes([]);
      setProjectLevelContextFragnetId(null);
      syncDeliverables([]);
      return;
    }
    setLoadingActivities(true);
    setLoadingDeliverables(true);
    try {
      const { data } = await activitiesApi.getProjectLevelContext(selectedProjectId);
      setActivities(data.activities);
      setRelationships([]);
      setAssuranceNotes([]);
      setProjectLevelContextFragnetId(data.fragnetId);
      syncDeliverables(data.deliverables);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load project-level activities");
      setActivities([]);
      setRelationships([]);
      setAssuranceNotes([]);
      setProjectLevelContextFragnetId(null);
      syncDeliverables([]);
    } finally {
      setLoadingActivities(false);
      setLoadingDeliverables(false);
    }
  };

  const fetchActivities = async () => {
    if (!selectedFragnetId) {
      setActivities([]);
      return;
    }
    if (selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID) {
      await fetchProjectLevelContext();
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
      syncDeliverables([]);
      return;
    }
    if (selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID) {
      await fetchProjectLevelContext();
      return;
    }
    setLoadingDeliverables(true);
    try {
      const { data } = await deliverablesApi.list(selectedProjectId, selectedFragnetId);
      syncDeliverables(data);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load deliverables");
      syncDeliverables([]);
    } finally {
      setLoadingDeliverables(false);
    }
  };

  const fetchRelationships = async () => {
    if (!selectedFragnetId || selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID) {
      setRelationships([]);
      setDeliverableActivityRelationships([]);
      setActivityToDeliverableRelationships([]);
      return;
    }
    setLoadingRelationships(true);
    try {
      const [activityRels, deliverableRels, sharedToDeliverableRels] = await Promise.all([
        relationshipsApi.listByFragnet(selectedFragnetId),
        deliverableActivityRelationshipsApi.listByFragnet(selectedFragnetId),
        activityToDeliverableRelationshipsApi.listByFragnet(selectedFragnetId),
      ]);
      setRelationships(activityRels.data);
      setDeliverableActivityRelationships(deliverableRels.data);
      setActivityToDeliverableRelationships(sharedToDeliverableRels.data);
    } catch {
      setRelationships([]);
      setDeliverableActivityRelationships([]);
      setActivityToDeliverableRelationships([]);
    } finally {
      setLoadingRelationships(false);
    }
  };

  const fetchAssuranceNotes = async () => {
    if (!selectedStandardId || selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID) {
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
    void fetchCodeTypes();
  }, [selectedProjectId]);

  useEffect(() => {
    void fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await rateCardApi.get();
        setRateCardEntries(data.entries ?? []);
      } catch {
        setRateCardEntries(null);
      }
    })();
  }, []);

  useEffect(() => {
    void fetchFragnets();
  }, [selectedProjectId, selectedStandardId]);

  useEffect(() => {
    if (selectedFragnetId === PROJECT_LEVEL_FRAGNET_ID) {
      void fetchProjectLevelContext();
      return;
    }
    void fetchActivities();
    void fetchRelationships();
    void fetchAssuranceNotes();
    void fetchDeliverables();
  }, [selectedProjectId, selectedFragnetId, selectedStandardId]);

  const createPrefilledRef = useRef(false);
  useEffect(() => {
    if (!createOpen) {
      createPrefilledRef.current = false;
      return;
    }
    if (!nextAvailableId || createPrefilledRef.current) return;
    setFormActivityCode(nextAvailableId);
    createPrefilledRef.current = true;
  }, [createOpen, nextAvailableId]);

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
    setFormLinkedDeliverableIds(deliverables[0]?.id ? [deliverables[0].id] : []);
    setFormIsSharedAcrossDeliverables(false);
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
      linkedDeliverableIds: formLinkedDeliverableIds,
      isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
      requireDeliverable: !isProjectLevelFragnetSelected,
      activityCode: formActivityCode,
      name: formName,
      bestDuration: formBestDuration,
      likelyDuration: formLikelyDuration,
    });
    if (!selectedProjectId || !selectedFragnetId || err) {
      toast.error(err || "Select a fragnet");
      return;
    }
    if (createCodeCheck.status && !createCodeCheck.status.available) {
      toast.error(createCodeCheck.status.message);
      return;
    }
    const best = parseInt(formBestDuration, 10);
    const likely = parseInt(formLikelyDuration, 10);
    setSubmitting(true);
    try {
      await activitiesApi.create({
        projectId: selectedProjectId,
        fragnetId: isProjectLevelFragnetSelected ? projectLevelContextFragnetId ?? undefined : selectedFragnetId,
        deliverableId: formDeliverableId || undefined,
        deliverableIds: formIsSharedAcrossDeliverables ? formLinkedDeliverableIds : undefined,
        activityCode: formActivityCode.trim(),
        name: formName.trim(),
        bestDuration: best,
        likelyDuration: likely,
        assuranceNoteId: formAssuranceNoteId || undefined,
        assignedResources: draftsToPayload(formResourceDrafts),
        isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
        activityCodeByTypeId: buildActivityCodePayload(formP6Codes, codeTypes, "create", mayEditP6Codes),
      });
      toast.success("Activity created");
      resetActivityForm();
      if (isProjectLevelFragnetSelected) {
        await fetchStandards();
        await fetchFragnets();
        await fetchProjectLevelContext();
      } else {
        await fetchActivities();
        await fetchRelationships();
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create activity");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
    const validationError = validateActivityDefinitionFields({
      scope: "deliverable",
      deliverableId: formDeliverableId,
      linkedDeliverableIds: formLinkedDeliverableIds,
      isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
      requireDeliverable: !isProjectLevelFragnetSelected,
      activityCode: formActivityCode,
      name: formName,
      bestDuration: formBestDuration,
      likelyDuration: formLikelyDuration,
    });
    if (validationError) {
      toast.error(validationError);
      return;
    }
    const best = formBestDuration === "" ? undefined : parseInt(formBestDuration, 10);
    const likely = formLikelyDuration === "" ? undefined : parseInt(formLikelyDuration, 10);
    if (best !== undefined && (!Number.isInteger(best) || best < 1)) {
      toast.error("Best duration must be a positive integer");
      return;
    }
    if (likely !== undefined && (!Number.isInteger(likely) || likely < 1)) {
      toast.error("Likely duration must be a positive integer");
      return;
    }
    if (editCodeCheck.status && !editCodeCheck.status.available) {
      toast.error(editCodeCheck.status.message);
      return;
    }
    setSubmitting(true);
    try {
      await activitiesApi.update(editId, {
        activityCode: formActivityCode.trim() || undefined,
        name: formName.trim() || undefined,
        deliverableId: formDeliverableId || undefined,
        deliverableIds: formIsSharedAcrossDeliverables ? formLinkedDeliverableIds : undefined,
        bestDuration: best,
        likelyDuration: likely,
        assuranceNoteId: formAssuranceNoteId || null,
        assignedResources: draftsToPayload(formResourceDrafts),
        isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
        activityCodeByTypeId: buildActivityCodePayload(formP6Codes, codeTypes, "update", mayEditP6Codes),
      });
      toast.success("Activity updated");
      resetActivityForm();
      if (isProjectLevelFragnetSelected) {
        await fetchProjectLevelContext();
      } else {
        await fetchActivities();
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update activity");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteActivity = async (id: string) => {
    if (!confirm("Delete this activity?")) return;
    setDeletingId(id);
    try {
      await activitiesApi.delete(id);
      toast.success("Activity deleted");
      if (isProjectLevelFragnetSelected) {
        await fetchProjectLevelContext();
      } else {
        await fetchActivities();
        await fetchRelationships();
      }
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
    setFormLinkedDeliverableIds(
      a.linkedDeliverables?.map((d) => d.id) ?? (a.deliverableId ? [a.deliverableId] : [])
    );
    setFormIsSharedAcrossDeliverables(Boolean(a.isSharedAcrossDeliverables));
    setFormAssuranceNoteId(a.assuranceNoteId ?? "");
    setFormResourceDrafts(storedToDrafts(a.assignedResources));
    setFormP6Codes({});
    setP6EditEpoch((e) => e + 1);
  };

  const selectedFragnet =
    fragnets.find((f) => f.id === selectedFragnetId) ??
    (isProjectLevelFragnetSelected ? ({ id: PROJECT_LEVEL_FRAGNET_ID, name: PROJECT_LEVEL_LABEL } as Fragnet) : undefined);

  const { predCount, succCount } = useMemo(
    () => buildRelationshipAdjacency(activities, relationships),
    [activities, relationships]
  );

  const filteredActivities = useMemo(
    () => filterActivities(activities, deliverables, listFilters),
    [activities, deliverables, listFilters]
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

  const activityLabel = useCallback(
    (id: string) => {
      const a = activities.find((x) => x.id === id);
      return a ? `${a.activityCode} — ${a.name}` : id.slice(0, 8);
    },
    [activities]
  );

  const deliverableLabel = useCallback(
    (id: string) => {
      const d = deliverables.find((x) => x.id === id);
      return d?.name ?? id.slice(0, 8);
    },
    [deliverables]
  );

  const formatActivityLinks = useCallback(
    (a: Activity) => {
      if (a.isSharedAcrossDeliverables) {
        const sharedSuccs = activityToDeliverableRelationships.filter(
          (r) => r.predecessorActivityId === a.id
        );
        if (sharedSuccs.length > 0) {
          return sharedSuccs
            .map((r) => `${r.relationshipType}→ ${deliverableLabel(r.successorDeliverableId)}`)
            .join(", ");
        }
      }
      const preds = predCount.get(a.id) ?? 0;
      const succs = succCount.get(a.id) ?? 0;
      const delPred = deliverableActivityRelationships.find((r) => r.successorActivityId === a.id);
      if (delPred && preds === 0) {
        return `${delPred.relationshipType}← ${deliverableLabel(delPred.predecessorDeliverableId)}`;
      }
      return `${preds}P / ${succs}S`;
    },
    [
      activityToDeliverableRelationships,
      deliverableActivityRelationships,
      predCount,
      succCount,
      deliverableLabel,
    ]
  );

  const handleCreateRelationship = async (data: {
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: RelationshipType;
    lag: number;
  }) => {
    if (!selectedFragnetId || isProjectLevelFragnetSelected) return;
    setRelSubmitting(true);
    try {
      await relationshipsApi.create({ fragnetId: selectedFragnetId, ...data });
      toast.success("Relationship created");
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create relationship");
      throw err;
    } finally {
      setRelSubmitting(false);
    }
  };

  const handleUpdateRelationship = async (
    id: string,
    data: { relationshipType?: RelationshipType; lag?: number }
  ) => {
    setRelSubmitting(true);
    try {
      await relationshipsApi.update(id, data);
      toast.success("Relationship updated");
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update relationship");
      throw err;
    } finally {
      setRelSubmitting(false);
    }
  };

  const handleDeleteRelationship = async (id: string) => {
    if (!confirm("Delete this relationship?")) return;
    setRelSubmitting(true);
    try {
      await relationshipsApi.delete(id);
      toast.success("Relationship deleted");
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete relationship");
      throw err;
    } finally {
      setRelSubmitting(false);
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
      if (isProjectLevelFragnetSelected) {
        await fetchProjectLevelContext();
      } else {
        await fetchActivities();
        await fetchRelationships();
      }
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Bulk delete failed");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Activities</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Add and edit activities per deliverable. Use Schedule workspace for logic and the Gantt.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Activity context</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingStandards ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading standards…
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Activities default to project-level deliverables. If you want a fragnet-specific view, choose a standard
                and fragnet below.
              </p>
              {standards.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  No user standards yet. You can still manage project-level activities without creating standards or fragnets.
                </p>
              ) : (
                <div className="flex flex-wrap gap-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Standard</label>
                    <select
                      value={selectedStandardId}
                      onChange={(e) => setSelectedStandardId(e.target.value)}
                      className={cn(
                        "flex h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800"
                      )}
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
                      disabled={!selectedStandardId || loadingFragnets}
                      className={cn(
                        "flex h-9 min-w-[200px] rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 disabled:opacity-50"
                      )}
                    >
                      <option value={PROJECT_LEVEL_FRAGNET_ID}>{PROJECT_LEVEL_LABEL}</option>
                      {fragnets.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Current view: {isProjectLevelFragnetSelected ? PROJECT_LEVEL_LABEL : selectedFragnet?.name ?? "Fragnet"}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {showActivityDevTools && selectedFragnetId && !isProjectLevelFragnetSelected && (
        <ActivityTemplatesPanel
          fragnetId={selectedFragnetId}
          fragnetName={selectedFragnet?.name ?? "Fragnet"}
          projectId={selectedProjectId ?? ""}
          mayEdit={mayEditByRole}
          mayEditP6Codes={mayEditP6Codes}
          onMaterialized={() => {
            void fetchActivities();
            void fetchRelationships();
          }}
        />
      )}

      {selectedFragnetId && (
        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Activities — {selectedFragnet?.name}</CardTitle>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {activities.length} activit{activities.length === 1 ? "y" : "ies"}
              </p>
            </div>
            {mayCreate ? (
              <Dialog
                open={createOpen}
                onOpenChange={(o) => {
                  setCreateOpen(o);
                  if (o) {
                    setFormResourceDrafts([]);
                    const nextPrimary = formDeliverableId || deliverables[0]?.id || "";
                    setFormDeliverableId(nextPrimary);
                    setFormLinkedDeliverableIds(nextPrimary ? [nextPrimary] : []);
                    setFormIsSharedAcrossDeliverables(false);
                  } else resetActivityForm();
                }}
              >
                <DialogTrigger asChild>
                  <Button type="button">
                    <Plus className="h-4 w-4" /> Add activity
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-[720px]">
                  <form onSubmit={handleCreateActivity} className="min-w-0">
                    <DialogHeader className="space-y-2 pb-2">
                      <DialogTitle>Add activity</DialogTitle>
                    </DialogHeader>
                    <ActivityDefinitionForm
                      scope="deliverable"
                      deliverables={deliverables}
                      loadingDeliverables={loadingDeliverables}
                      formDeliverableId={formDeliverableId}
                      onDeliverableId={(id) => {
                        setFormDeliverableId(id);
                        setFormLinkedDeliverableIds((prev) => [...new Set([id, ...prev.filter(Boolean)])]);
                      }}
                      formLinkedDeliverableIds={formLinkedDeliverableIds}
                      onLinkedDeliverableIds={setFormLinkedDeliverableIds}
                      formIsSharedAcrossDeliverables={formIsSharedAcrossDeliverables}
                      onIsSharedAcrossDeliverables={setFormIsSharedAcrossDeliverables}
                      allowEmptyDeliverable={isProjectLevelFragnetSelected}
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
                      activityCodeHint={createCodeCheck.status?.message ?? null}
                      activityCodeAvailable={createCodeCheck.status?.available ?? null}
                      activityCodeChecking={createCodeCheck.checking}
                      suggestedActivityCode={createCodeCheck.status?.suggestedCode ?? null}
                      nextAvailableActivityId={nextAvailableId}
                      nextAvailableLoading={nextAvailableLoading}
                      onUseSuggestedCode={setFormActivityCode}
                    />
                    <DialogFooter className="gap-2 pt-4">
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={
                          submitting ||
                          createCodeCheck.checking ||
                          (createCodeCheck.status != null && !createCodeCheck.status.available)
                        }
                      >
                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create activity
                      </Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            {activities.length > 0 && (
              <>
                <ActivityListToolbar
                  filters={listFilters}
                  onChange={setListFilters}
                  totalCount={activities.length}
                  filteredCount={filteredActivities.length}
                />
                <ActivityBulkActionsBar
                  selectedCount={selectedIds.size}
                  onClear={() => setSelectedIds(new Set())}
                  onBulkDelete={handleBulkDelete}
                  busy={bulkBusy}
                  canDelete={mayDeleteByRole}
                />
              </>
            )}
            {loadingActivities ? (
              <div className="flex justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : activities.length === 0 ? (
              <p className="py-8 text-center text-slate-500">No activities. Add one to get started.</p>
            ) : filteredActivities.length === 0 ? (
              <p className="py-8 text-center text-slate-500">No activities match filters.</p>
            ) : (
              <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <input
                          type="checkbox"
                          aria-label="Select all"
                          checked={
                            selectedIds.size === filteredActivities.length && filteredActivities.length > 0
                          }
                          onChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Code</TableHead>
                      <TableHead>Deliverable</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead className="text-right">Best</TableHead>
                      <TableHead className="text-right">Likely</TableHead>
                      <TableHead>Links</TableHead>
                      <TableHead className="w-[100px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredActivities.map((a) => {
                      const linkedNames = a.linkedDeliverables?.map((d) => d.name) ?? [];
                      const dName = linkedNames[0] ?? deliverables.find((d) => d.id === a.deliverableId)?.name ?? "—";
                      const deliverableSummary =
                        linkedNames.length > 1 ? `${dName} + ${linkedNames.length - 1} linked` : dName;
                      const linksLabel = formatActivityLinks(a);
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
                          <TableCell className="max-w-[180px] truncate text-sm text-slate-600 dark:text-slate-400" title={linkedNames.join(", ") || dName}>
                            {deliverableSummary}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap items-center gap-2">
                              <span>{a.name}</span>
                              {a.isSharedAcrossDeliverables ? (
                                <span className="rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
                                  Shared
                                </span>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{a.bestDuration}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.likelyDuration}</TableCell>
                          <TableCell className="text-xs text-slate-600 dark:text-slate-400">{linksLabel}</TableCell>
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
                                      onDeliverableId={(id) => {
                                        setFormDeliverableId(id);
                                        setFormLinkedDeliverableIds((prev) => [...new Set([id, ...prev.filter(Boolean)])]);
                                      }}
                                      formLinkedDeliverableIds={formLinkedDeliverableIds}
                                      onLinkedDeliverableIds={setFormLinkedDeliverableIds}
                                      formIsSharedAcrossDeliverables={formIsSharedAcrossDeliverables}
                                      onIsSharedAcrossDeliverables={setFormIsSharedAcrossDeliverables}
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
                                      onP6Code={(typeId, codeId) =>
                                        setFormP6Codes((prev) => ({ ...prev, [typeId]: codeId }))
                                      }
                                      rateCardEntries={rateCardEntries}
                                      formResourceDrafts={formResourceDrafts}
                                      onResourceDrafts={setFormResourceDrafts}
                                      submitting={submitting}
                                      activityCodeHint={editCodeCheck.status?.message ?? null}
                                      activityCodeAvailable={editCodeCheck.status?.available ?? null}
                                      activityCodeChecking={editCodeCheck.checking}
                                      suggestedActivityCode={editCodeCheck.status?.suggestedCode ?? null}
                                      nextAvailableActivityId={nextAvailableId}
                                      nextAvailableLoading={nextAvailableLoading}
                                      onUseSuggestedCode={setFormActivityCode}
                                    />
                                    <DialogFooter className="gap-2 pt-4">
                                      <Button type="button" variant="outline" onClick={() => setEditId(null)}>
                                        Cancel
                                      </Button>
                                      <Button
                                        type="submit"
                                        disabled={
                                          submitting ||
                                          editCodeCheck.checking ||
                                          (editCodeCheck.status != null && !editCodeCheck.status.available)
                                        }
                                      >
                                        {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save
                                      </Button>
                                    </DialogFooter>
                                  </form>
                                </DialogContent>
                              </Dialog>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => handleDeleteActivity(a.id)}
                                disabled={!mayDeleteByRole || deletingId === a.id}
                                title={!mayDeleteByRole ? "No permission" : "Delete"}
                              >
                                {deletingId === a.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Trash2 className="h-4 w-4 text-red-600" />
                                )}
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
      )}

      {selectedFragnetId && !isProjectLevelFragnetSelected && (
        <ActivityRelationshipsPanel
          activities={activities}
          relationships={relationships}
          deliverableActivityRelationships={deliverableActivityRelationships}
          activityToDeliverableRelationships={activityToDeliverableRelationships}
          deliverableLabel={deliverableLabel}
          loading={loadingRelationships}
          mayEdit={mayEditRel}
          mayDelete={mayDeleteRel}
          submitting={relSubmitting}
          onCreate={handleCreateRelationship}
          onUpdate={handleUpdateRelationship}
          onDelete={handleDeleteRelationship}
          activityLabel={activityLabel}
        />
      )}
    </div>
  );
}
