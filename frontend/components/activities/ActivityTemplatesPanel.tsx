"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ListOrdered, Loader2, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { ActivityDefinitionForm } from "@/components/activities/ActivityDefinitionForm";
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
import { fieldClass } from "@/components/schedule/form-section";
import {
  activityCodeTypesApi,
  fragnetsApi,
  rateCardApi,
  type ActivityCodeType,
  type FragnetActivityTemplate,
  type RateCardEntry,
  type RelationshipType,
  getApiErrorMessage,
} from "@/lib/api";
import {
  buildActivityCodePayload,
  buildP6FormMapFromAssignments,
  emptyP6FormMap,
  validateActivityDefinitionFields,
} from "@/lib/activity-form-utils";
import {
  ResourceAssignmentsEditor,
  draftsToPayload,
  storedToDrafts,
  type ResourceAssignmentDraft,
} from "@/components/resource-assignments-editor";
import { cn } from "@/lib/utils";

const REL_TYPES: RelationshipType[] = ["FS", "SS", "FF", "SF"];

function resetDefaultFormState(codeTypes: ActivityCodeType[]) {
  return {
    code: "",
    name: "",
    best: "1",
    likely: "1",
    isSharedAcrossDeliverables: false,
    resourceDrafts: [] as ResourceAssignmentDraft[],
    p6Codes: emptyP6FormMap(codeTypes),
  };
}

export function ActivityTemplatesPanel(props: {
  fragnetId: string;
  fragnetName: string;
  projectId: string;
  mayEdit: boolean;
  mayEditP6Codes: boolean;
  onMaterialized?: () => void;
}) {
  const { fragnetId, fragnetName, projectId, mayEdit, mayEditP6Codes, onMaterialized } = props;
  const [defaults, setDefaults] = useState<FragnetActivityTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [codeTypes, setCodeTypes] = useState<ActivityCodeType[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formCode, setFormCode] = useState("");
  const [formName, setFormName] = useState("");
  const [formBest, setFormBest] = useState("1");
  const [formLikely, setFormLikely] = useState("1");
  const [formIsSharedAcrossDeliverables, setFormIsSharedAcrossDeliverables] = useState(false);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [formP6Codes, setFormP6Codes] = useState<Record<string, string>>({});
  const [relPred, setRelPred] = useState("");
  const [relSucc, setRelSucc] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("FS");
  const [relLag, setRelLag] = useState("0");

  const loadCodeTypes = useCallback(async () => {
    if (!projectId) {
      setCodeTypes([]);
      return;
    }
    try {
      const { data } = await activityCodeTypesApi.list(projectId);
      setCodeTypes(data);
    } catch {
      setCodeTypes([]);
    }
  }, [projectId]);

  const load = useCallback(async () => {
    if (!fragnetId) return;
    setLoading(true);
    try {
      const [t, rc] = await Promise.all([
        fragnetsApi.listActivityTemplates(fragnetId),
        rateCardApi.get().catch(() => ({ data: { entries: [] as RateCardEntry[] } })),
      ]);
      setDefaults(t.data);
      setRateCardEntries(rc.data.entries ?? []);
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to load default activities");
    } finally {
      setLoading(false);
    }
  }, [fragnetId]);

  useEffect(() => {
    load();
    loadCodeTypes();
  }, [load, loadCodeTypes]);

  const closeFormDialog = () => {
    const empty = resetDefaultFormState(codeTypes);
    setFormCode(empty.code);
    setFormName(empty.name);
    setFormBest(empty.best);
    setFormLikely(empty.likely);
    setFormIsSharedAcrossDeliverables(empty.isSharedAcrossDeliverables);
    setFormResourceDrafts(empty.resourceDrafts);
    setFormP6Codes(empty.p6Codes);
    setDialogOpen(false);
    setEditId(null);
  };

  const openCreate = () => {
    const empty = resetDefaultFormState(codeTypes);
    setFormCode(empty.code);
    setFormName(empty.name);
    setFormBest(empty.best);
    setFormLikely(empty.likely);
    setFormIsSharedAcrossDeliverables(empty.isSharedAcrossDeliverables);
    setFormResourceDrafts(empty.resourceDrafts);
    setFormP6Codes(empty.p6Codes);
    setEditId(null);
    setDialogOpen(true);
  };

  const openEdit = (t: FragnetActivityTemplate) => {
    setDialogOpen(true);
    setEditId(t.id);
    setFormCode(t.templateCode);
    setFormName(t.name);
    setFormBest(String(t.bestDuration));
    setFormLikely(String(t.likelyDuration));
    setFormIsSharedAcrossDeliverables(Boolean(t.isSharedAcrossDeliverables));
    setFormResourceDrafts(storedToDrafts(t.assignedResources));
    setFormP6Codes(buildP6FormMapFromAssignments(t.activityCodeAssignments, codeTypes));
  };

  const handleSaveDefault = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateActivityDefinitionFields({
      scope: "default",
      activityCode: formCode,
      name: formName,
      bestDuration: formBest,
      likelyDuration: formLikely,
    });
    if (err) {
      toast.error(err);
      return;
    }
    const best = parseInt(formBest, 10);
    const likely = parseInt(formLikely, 10);
    const p6Payload = buildActivityCodePayload(formP6Codes, codeTypes, editId ? "update" : "create", mayEditP6Codes);

    setSubmitting(true);
    try {
      if (editId) {
        await fragnetsApi.updateActivityTemplate(fragnetId, editId, {
          name: formName.trim(),
          bestDuration: best,
          likelyDuration: likely,
          isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
          assignedResources: draftsToPayload(formResourceDrafts),
          activityCodeByTypeId: p6Payload,
        });
        toast.success("Default activity updated");
      } else {
        await fragnetsApi.createActivityTemplate(fragnetId, {
          templateCode: formCode.trim(),
          name: formName.trim(),
          bestDuration: best,
          likelyDuration: likely,
          isSharedAcrossDeliverables: formIsSharedAcrossDeliverables,
          assignedResources: draftsToPayload(formResourceDrafts),
          activityCodeByTypeId: p6Payload,
        });
        toast.success("Default activity added to all deliverables in this fragnet");
      }
      closeFormDialog();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || (editId ? "Failed to update" : "Failed to add default activity"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Remove this default activity from the fragnet?")) return;
    try {
      await fragnetsApi.deleteActivityTemplate(fragnetId, id);
      toast.success("Default activity removed");
      if (editId === id) closeFormDialog();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to delete");
    }
  };

  const handleMaterialize = async () => {
    setSubmitting(true);
    try {
      const { data } = await fragnetsApi.materializeActivityTemplates(fragnetId);
      toast.success(
        `Materialized ${data.activities} new activit${data.activities === 1 ? "y" : "ies"} across ${data.deliverables} deliverable${data.deliverables === 1 ? "" : "s"}`
      );
      onMaterialized?.();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Materialize failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleApply = async () => {
    setSubmitting(true);
    try {
      const { data } = await fragnetsApi.syncActivityTemplates(fragnetId);
      toast.success(`Synced templates: ${data.updated} updated, ${data.activities} new activities`);
      onMaterialized?.();
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Sync failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRealignCodes = async () => {
    setSubmitting(true);
    try {
      const { data } = await fragnetsApi.realignActivityCodes(fragnetId);
      toast.success(
        data.updated > 0
          ? `Updated ${data.updated} activity code${data.updated === 1 ? "" : "s"} to A1001, A1002, … across the project`
          : "Activity codes are already sequential (A1001, A1002, …)"
      );
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to update activity codes");
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddRel = async () => {
    if (!relPred || !relSucc) {
      toast.error("Select predecessor and successor default activities");
      return;
    }
    setSubmitting(true);
    try {
      await fragnetsApi.createTemplateRelationship(fragnetId, {
        predecessorTemplateId: relPred,
        successorTemplateId: relSucc,
        relationshipType: relType,
        lag: parseInt(relLag, 10) || 0,
      });
      toast.success("Default activity link added");
      setRelPred("");
      setRelSucc("");
      await load();
    } catch (err) {
      toast.error(getApiErrorMessage(err) || "Failed to add link");
    } finally {
      setSubmitting(false);
    }
  };

  const defaultRels = defaults.flatMap((t) =>
    (t.successorIn ?? []).map((r) => ({
      ...r,
      predCode: defaults.find((x) => x.id === r.predecessorTemplateId)?.templateCode,
      succCode: defaults.find((x) => x.id === r.successorTemplateId)?.templateCode,
    }))
  );

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="h-4 w-4 text-violet-600" />
            Activity templates — {fragnetName}
          </CardTitle>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
            Template definitions only. Click <strong>Materialize activities</strong> to create one activity row
            per deliverable (non-shared) or one shared row per template (shared).
          </p>
        </div>
        {mayEdit && (
          <Dialog open={dialogOpen} onOpenChange={(o) => (o ? setDialogOpen(true) : closeFormDialog())}>
            <DialogTrigger asChild>
              <Button type="button" variant="outline" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" /> Add template
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[720px]">
              <form onSubmit={handleSaveDefault} className="min-w-0">
                <DialogHeader className="space-y-2 pb-2">
                  <DialogTitle>{editId ? "Edit activity template" : "Add activity template"}</DialogTitle>
                  <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                    Definition only — materialize to create actual activity instances on deliverables.
                  </p>
                </DialogHeader>
                <ActivityDefinitionForm
                  scope="default"
                  formActivityCode={formCode}
                  onActivityCode={setFormCode}
                  formName={formName}
                  onName={setFormName}
                  formBestDuration={formBest}
                  onBestDuration={setFormBest}
                  formLikelyDuration={formLikely}
                  onLikelyDuration={setFormLikely}
                  mayEditP6Codes={mayEditP6Codes}
                  codeTypes={codeTypes}
                  formP6Codes={formP6Codes}
                  onP6Code={(typeId, codeId) => setFormP6Codes((prev) => ({ ...prev, [typeId]: codeId }))}
                  rateCardEntries={rateCardEntries}
                  formResourceDrafts={formResourceDrafts}
                  onResourceDrafts={setFormResourceDrafts}
                  submitting={submitting}
                  lockActivityCode={!!editId}
                  formIsSharedAcrossDeliverables={formIsSharedAcrossDeliverables}
                  onIsSharedAcrossDeliverables={setFormIsSharedAcrossDeliverables}
                  extraSections={
                    <div className="rounded-md border border-slate-200 px-3 py-3 text-sm dark:border-slate-800">
                      <label className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={formIsSharedAcrossDeliverables}
                          onChange={(e) => setFormIsSharedAcrossDeliverables(e.target.checked)}
                        />
                        <span className="space-y-1">
                          <span className="block font-medium text-slate-900 dark:text-slate-100">
                            Shared Across Deliverables
                          </span>
                          <span className="block text-xs text-slate-500 dark:text-slate-400">
                            Materialize one shared activity for this template. Link deliverables when editing the shared activity instance.
                          </span>
                        </span>
                      </label>
                    </div>
                  }
                />
                <DialogFooter className="gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={closeFormDialog}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                    {editId ? "Save" : "Add template"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {defaults.length === 0 ? (
              <p className="text-sm text-slate-500">No activity templates yet.</p>
            ) : (
              <ol className="space-y-2">
                {defaults.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-violet-200/80 bg-violet-50/40 px-4 py-3 text-sm dark:border-violet-900/40 dark:bg-violet-950/20"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-xs text-violet-700 dark:text-violet-300">{t.templateCode}</span>
                      <span className="mx-2 text-slate-400">·</span>
                      <span className="font-medium text-slate-900 dark:text-white">{t.name}</span>
                      <span className="ml-2 text-xs text-slate-500">
                        {t.bestDuration}d / {t.likelyDuration}d
                      </span>
                      {t.isSharedAcrossDeliverables ? (
                        <span className="ml-2 rounded-full bg-cyan-100 px-2 py-0.5 text-xs font-medium text-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
                          Shared
                        </span>
                      ) : null}
                      {(t.assignedResources?.length ?? 0) > 0 && (
                        <span className="ml-2 text-xs text-slate-500">
                          · {(t.assignedResources?.length ?? 0)} resource
                          {(t.assignedResources?.length ?? 0) === 1 ? "" : "s"}
                        </span>
                      )}
                      {(t.activityCodeAssignments?.length ?? 0) > 0 && (
                        <span className="ml-2 text-xs text-slate-500">
                          · {(t.activityCodeAssignments?.length ?? 0)} P6 code
                          {(t.activityCodeAssignments?.length ?? 0) === 1 ? "" : "s"}
                        </span>
                      )}
                    </div>
                    {mayEdit && (
                      <div className="flex shrink-0 gap-1">
                        <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(t)} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button type="button" variant="ghost" size="icon" onClick={() => handleDelete(t.id)} title="Remove">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {defaultRels.length > 0 && (
              <div className="text-sm">
                <p className="mb-2 font-medium text-slate-800 dark:text-slate-200">Default links</p>
                <ul className="space-y-1 text-slate-600 dark:text-slate-400">
                  {defaultRels.map((r) => (
                    <li key={r.id}>
                      {r.predCode} → {r.succCode} ({r.relationshipType}
                      {r.lag ? `, lag ${r.lag}` : ""})
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {mayEdit && defaults.length >= 2 && (
              <div className="space-y-3 rounded-lg border border-slate-200 p-5 dark:border-slate-700">
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Link default activities</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Default predecessor/successor sequencing applied when activities are materialized.
                </p>
                <div className="flex flex-wrap gap-2">
                  <select value={relPred} onChange={(e) => setRelPred(e.target.value)} className={fieldClass}>
                    <option value="">Predecessor…</option>
                    {defaults.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.templateCode}
                      </option>
                    ))}
                  </select>
                  <select value={relSucc} onChange={(e) => setRelSucc(e.target.value)} className={fieldClass}>
                    <option value="">Successor…</option>
                    {defaults.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.templateCode}
                      </option>
                    ))}
                  </select>
                  <select
                    value={relType}
                    onChange={(e) => setRelType(e.target.value as RelationshipType)}
                    className={cn(fieldClass, "w-24")}
                  >
                    {REL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                  <Input className="h-10 w-20" type="number" value={relLag} onChange={(e) => setRelLag(e.target.value)} placeholder="Lag" />
                  <Button type="button" size="sm" variant="outline" onClick={handleAddRel} disabled={submitting}>
                    Add link
                  </Button>
                </div>
              </div>
            )}

            {mayEdit && defaults.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={handleMaterialize} disabled={submitting}>
                  <RefreshCw className="h-4 w-4" /> Materialize (dev)
                </Button>
                <Button type="button" variant="outline" onClick={handleApply} disabled={submitting}>
                  Sync (dev)
                </Button>
                <Button type="button" variant="outline" onClick={handleRealignCodes} disabled={submitting}>
                  Realign codes (dev)
                </Button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
