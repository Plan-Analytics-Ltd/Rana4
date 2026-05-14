"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2, Link2 } from "lucide-react";
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

const RELATIONSHIP_TYPES: RelationshipType[] = ["FS", "SS", "FF", "SF"];

/** P6 form map: deliverable defaults, then activity overrides (per type). */
function buildActivityP6FormMap(a: Activity, types: ActivityCodeType[], dels: Deliverable[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const t of types) next[t.id] = "__NONE__";
  const deliverableId = a.deliverableId;
  const d = deliverableId ? dels.find((x) => x.id === deliverableId) : undefined;
  for (const row of d?.activityCodeAssignments ?? []) {
    next[row.typeId] = row.codeId;
  }
  for (const row of a.activityCodeAssignments ?? []) {
    next[row.typeId] = row.codeId;
  }
  return next;
}

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
  const [editId, setEditId] = useState<string | null>(null);
  const [relCreateOpen, setRelCreateOpen] = useState(false);
  const [formActivityCode, setFormActivityCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formBestDuration, setFormBestDuration] = useState("");
  const [formLikelyDuration, setFormLikelyDuration] = useState("");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [loadingDeliverables, setLoadingDeliverables] = useState(false);
  const [formDeliverableId, setFormDeliverableId] = useState<string>("");
  const [formAssuranceNoteId, setFormAssuranceNoteId] = useState<string>("");
  const [relPredecessorId, setRelPredecessorId] = useState("");
  const [relSuccessorId, setRelSuccessorId] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("FS");
  const [relLag, setRelLag] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingRelId, setDeletingRelId] = useState<string | null>(null);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [codeTypes, setCodeTypes] = useState<ActivityCodeType[]>([]);
  const [formP6Codes, setFormP6Codes] = useState<Record<string, string>>({});
  /** Bumps when opening the edit dialog so P6 fields re-merge after code types / deliverables load. */
  const [p6EditEpoch, setP6EditEpoch] = useState(0);

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
    setFormP6Codes(buildActivityP6FormMap(a, codeTypes, deliverables));
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

  const resetRelForm = () => {
    setRelPredecessorId("");
    setRelSuccessorId("");
    setRelType("FS");
    setRelLag("0");
    setRelCreateOpen(false);
  };

  const buildActivityCodePayloadForCreate = (): Record<string, string | null> | undefined => {
    if (!mayEditP6Codes || codeTypes.length === 0) return undefined;
    const out: Record<string, string | null> = {};
    let any = false;
    for (const t of codeTypes) {
      const v = formP6Codes[t.id];
      if (v && v !== "__NONE__") {
        out[t.id] = v;
        any = true;
      }
    }
    return any ? out : undefined;
  };

  const buildActivityCodePayloadForUpdate = (): Record<string, string | null> | undefined => {
    if (!mayEditP6Codes || codeTypes.length === 0) return undefined;
    const out: Record<string, string | null> = {};
    for (const t of codeTypes) {
      const v = formP6Codes[t.id];
      out[t.id] = !v || v === "__NONE__" ? null : v;
    }
    return out;
  };

  const handleCreateActivity = async (e: React.FormEvent) => {
    e.preventDefault();
    const best = parseInt(formBestDuration, 10);
    const likely = parseInt(formLikelyDuration, 10);
    if (
      !selectedFragnetId ||
      !formDeliverableId ||
      !formActivityCode.trim() ||
      !formName.trim() ||
      !Number.isInteger(best) ||
      best < 1 ||
      !Number.isInteger(likely) ||
      likely < 1
    ) {
      toast.error("Deliverable, activity code, name, and positive durations are required");
      return;
    }
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
        activityCodeByTypeId: buildActivityCodePayloadForCreate(),
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
        activityCodeByTypeId: buildActivityCodePayloadForUpdate(),
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

  const handleCreateRelationship = async (e: React.FormEvent) => {
    e.preventDefault();
    const lag = parseInt(relLag, 10) || 0;
    if (!selectedFragnetId || !relPredecessorId || !relSuccessorId) {
      toast.error("Select predecessor and successor activities");
      return;
    }
    if (relPredecessorId === relSuccessorId) {
      toast.error("Predecessor and successor must be different");
      return;
    }
    setSubmitting(true);
    try {
      await relationshipsApi.create({
        fragnetId: selectedFragnetId,
        predecessorActivityId: relPredecessorId,
        successorActivityId: relSuccessorId,
        relationshipType: relType,
        lag,
      });
      toast.success("Relationship created");
      resetRelForm();
      await fetchRelationships();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create relationship");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteRelationship = async (id: string) => {
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
  };

  const openEditActivity = (a: Activity) => {
    setEditId(a.id);
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
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle>Activities — {selectedFragnet?.name}</CardTitle>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{activities.length} activit{activities.length === 1 ? "y" : "ies"}</p>
              </div>
              <Dialog
                open={createOpen}
                onOpenChange={(o) => {
                  setCreateOpen(o);
                  if (o) {
                    setFormResourceDrafts([]);
                    setFormDeliverableId((prev) => prev || deliverables[0]?.id || "");
                  }
                  else resetActivityForm();
                }}
              >
                {mayCreate ? (
                  <DialogTrigger asChild>
                    <Button><Plus className="h-4 w-4" /> Add Activity</Button>
                  </DialogTrigger>
                ) : null}
                <DialogContent>
                  <form onSubmit={handleCreateActivity} className="min-w-0">
                    <DialogHeader><DialogTitle>Create Activity</DialogTitle></DialogHeader>
                    <div className="grid min-w-0 gap-4 py-4">
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Deliverable</label>
                        <select
                          value={formDeliverableId}
                          onChange={(e) => setFormDeliverableId(e.target.value)}
                          disabled={loadingDeliverables || deliverables.length === 0}
                          className={cn(
                            "flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                            "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50"
                          )}
                          required
                        >
                          {deliverables.length === 0 ? (
                            <option value="">No deliverables found for this fragnet</option>
                          ) : null}
                          {deliverables.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                        {deliverables.length === 0 ? (
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Create a deliverable for this fragnet before adding activities.
                          </p>
                        ) : null}
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Activity code</label>
                        <Input value={formActivityCode} onChange={(e) => setFormActivityCode(e.target.value)} placeholder="e.g. A100" required />
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                        <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Activity name" required />
                      </div>
                      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="grid min-w-0 gap-2">
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Best duration</label>
                          <Input className="min-w-0" type="number" min={1} value={formBestDuration} onChange={(e) => setFormBestDuration(e.target.value)} required />
                        </div>
                        <div className="grid min-w-0 gap-2">
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Likely duration</label>
                          <Input className="min-w-0" type="number" min={1} value={formLikelyDuration} onChange={(e) => setFormLikelyDuration(e.target.value)} required />
                        </div>
                      </div>
                      {assuranceNotes.length > 0 && (
                        <div className="grid gap-2">
                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Assurance note (optional)</label>
                          <select
                            value={formAssuranceNoteId}
                            onChange={(e) => setFormAssuranceNoteId(e.target.value)}
                            className={cn("flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2")}
                          >
                            <option value="">None</option>
                            {assuranceNotes.map((n) => (
                              <option key={n.id} value={n.id}>{n.noteText.slice(0, 50)}{n.noteText.length > 50 ? "…" : ""}</option>
                            ))}
                          </select>
                        </div>
                      )}
                      {mayEditP6Codes && codeTypes.length > 0 ? (
                        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Primavera activity codes</div>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Optional: one value per type. Manage the catalog under Activity codes.
                          </p>
                          {codeTypes.map((t) => (
                            <div key={t.id} className="grid gap-1">
                              <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.name}</label>
                              <select
                                value={formP6Codes[t.id] ?? "__NONE__"}
                                onChange={(e) => setFormP6Codes((prev) => ({ ...prev, [t.id]: e.target.value }))}
                                className={cn(
                                  "flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                                  "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                                )}
                              >
                                <option value="__NONE__">— None —</option>
                                {(t.codes ?? []).map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {c.shortName || c.name}
                                  </option>
                                ))}
                              </select>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <ResourceAssignmentsEditor
                        entries={rateCardEntries}
                        value={formResourceDrafts}
                        onChange={setFormResourceDrafts}
                        disabled={submitting}
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
                      <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingActivities ? (
                <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
              ) : activities.length === 0 ? (
                <p className="py-8 text-center text-slate-500 dark:text-slate-400">No activities. Add one to get started.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>P6 codes</TableHead>
                      <TableHead>Best</TableHead>
                      <TableHead>Likely</TableHead>
                      <TableHead>Resources</TableHead>
                      <TableHead className="w-[120px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activities.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell className="font-medium">{a.activityCode}</TableCell>
                        <TableCell>{a.name}</TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-slate-600 dark:text-slate-400" title={p6Snippet(a)}>
                          {p6Snippet(a)}
                        </TableCell>
                        <TableCell>{a.bestDuration}</TableCell>
                        <TableCell>{a.likelyDuration}</TableCell>
                        <TableCell className="text-sm text-slate-600 dark:text-slate-400">
                          {a.assignedResources?.length ?? 0}
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
                              <DialogContent>
                                <form onSubmit={handleUpdateActivity} className="min-w-0">
                                  <DialogHeader><DialogTitle>Edit Activity</DialogTitle></DialogHeader>
                                    <div className="grid min-w-0 gap-4 py-4">
                                      <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Deliverable</label>
                                        <select
                                          value={formDeliverableId}
                                          onChange={(e) => setFormDeliverableId(e.target.value)}
                                          disabled={loadingDeliverables || deliverables.length === 0}
                                          className={cn(
                                            "flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                                            "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50"
                                          )}
                                        >
                                          {deliverables.map((d) => (
                                            <option key={d.id} value={d.id}>{d.name}</option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="grid gap-2">
                                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                                        <Input value={formName} onChange={(e) => setFormName(e.target.value)} required />
                                      </div>
                                      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="grid min-w-0 gap-2">
                                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Best duration</label>
                                          <Input className="min-w-0" type="number" min={1} value={formBestDuration} onChange={(e) => setFormBestDuration(e.target.value)} />
                                        </div>
                                        <div className="grid min-w-0 gap-2">
                                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Likely duration</label>
                                          <Input className="min-w-0" type="number" min={1} value={formLikelyDuration} onChange={(e) => setFormLikelyDuration(e.target.value)} />
                                        </div>
                                      </div>
                                      {assuranceNotes.length > 0 && (
                                        <div className="grid gap-2">
                                          <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Assurance note</label>
                                          <select value={formAssuranceNoteId} onChange={(e) => setFormAssuranceNoteId(e.target.value)} className={cn("flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2")}>
                                            <option value="">None</option>
                                            {assuranceNotes.map((n) => (
                                              <option key={n.id} value={n.id}>{n.noteText.slice(0, 50)}{n.noteText.length > 50 ? "…" : ""}</option>
                                            ))}
                                          </select>
                                        </div>
                                      )}
                                      {mayEditP6Codes && codeTypes.length > 0 ? (
                                        <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                                          <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Primavera activity codes</div>
                                          {codeTypes.map((t) => (
                                            <div key={t.id} className="grid gap-1">
                                              <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{t.name}</label>
                                              <select
                                                value={formP6Codes[t.id] ?? "__NONE__"}
                                                onChange={(e) => setFormP6Codes((prev) => ({ ...prev, [t.id]: e.target.value }))}
                                                className={cn(
                                                  "flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                                                  "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                                                )}
                                              >
                                                <option value="__NONE__">— None —</option>
                                                {(t.codes ?? []).map((c) => (
                                                  <option key={c.id} value={c.id}>
                                                    {c.shortName || c.name}
                                                  </option>
                                                ))}
                                              </select>
                                            </div>
                                          ))}
                                        </div>
                                      ) : null}
                                      <ResourceAssignmentsEditor
                                        entries={rateCardEntries}
                                        value={formResourceDrafts}
                                        onChange={setFormResourceDrafts}
                                        disabled={submitting}
                                      />
                                    </div>
                                  <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                                    <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
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
                              {deletingId === a.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" /> Relationships</CardTitle>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{relationships.length} relationship{relationships.length !== 1 ? "s" : ""}</p>
              </div>
              <Dialog open={relCreateOpen} onOpenChange={(o) => { setRelCreateOpen(o); if (!o) resetRelForm(); }}>
                {mayEditByRole ? (
                  <DialogTrigger asChild>
                    <Button disabled={activities.length < 2}><Plus className="h-4 w-4" /> Add Relationship</Button>
                  </DialogTrigger>
                ) : null}
                <DialogContent>
                  <form onSubmit={handleCreateRelationship}>
                    <DialogHeader><DialogTitle>Create Relationship</DialogTitle></DialogHeader>
                    <div className="grid gap-4 py-4">
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Predecessor</label>
                        <select value={relPredecessorId} onChange={(e) => setRelPredecessorId(e.target.value)} className={cn("flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2")} required>
                          <option value="">Select activity</option>
                          {activities.map((a) => (
                            <option key={a.id} value={a.id}>{a.activityCode} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Successor</label>
                        <select value={relSuccessorId} onChange={(e) => setRelSuccessorId(e.target.value)} className={cn("flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2")} required>
                          <option value="">Select activity</option>
                          {activities.map((a) => (
                            <option key={a.id} value={a.id}>{a.activityCode} — {a.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Type</label>
                        <select value={relType} onChange={(e) => setRelType(e.target.value as RelationshipType)} className={cn("flex h-9 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2")}>
                          {RELATIONSHIP_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid gap-2">
                        <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Lag</label>
                        <Input type="number" value={relLag} onChange={(e) => setRelLag(e.target.value)} />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={resetRelForm}>Cancel</Button>
                      <Button type="submit" disabled={submitting}>{submitting && <Loader2 className="h-4 w-4 animate-spin" />} Create</Button>
                    </DialogFooter>
                  </form>
                </DialogContent>
              </Dialog>
            </CardHeader>
            <CardContent>
              {loadingRelationships ? (
                <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
              ) : relationships.length === 0 ? (
                <p className="py-6 text-center text-slate-500 dark:text-slate-400">No relationships. Add at least two activities, then link them.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Predecessor</TableHead>
                      <TableHead>Successor</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Lag</TableHead>
                      <TableHead className="w-[80px] text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {relationships.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{activityById(r.predecessorActivityId)?.activityCode ?? r.predecessorActivityId}</TableCell>
                        <TableCell>{activityById(r.successorActivityId)?.activityCode ?? r.successorActivityId}</TableCell>
                        <TableCell>{r.relationshipType}</TableCell>
                        <TableCell>{r.lag}</TableCell>
                        <TableCell className="text-right">
                          {mayDeleteRelationshipByRole ? (
                            <Button variant="outline" size="icon" onClick={() => handleDeleteRelationship(r.id)} disabled={deletingRelId === r.id}>
                              {deletingRelId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
