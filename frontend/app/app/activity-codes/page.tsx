"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import { activityCodeTypesApi, activityCodesApi, type ActivityCodeType, type ActivityCodeValue, getApiErrorMessage } from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { hasPermission } from "@/lib/project-permissions";

export default function ActivityCodesPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayRead = hasPermission(selectedProjectRole, "activityCode", "read");
  const mayCreate = hasPermission(selectedProjectRole, "activityCode", "create");
  const mayDelete = hasPermission(selectedProjectRole, "activityCode", "delete");

  const [types, setTypes] = useState<ActivityCodeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeDialogOpen, setTypeDialogOpen] = useState(false);
  const [typeName, setTypeName] = useState("");
  const [typeSlug, setTypeSlug] = useState("");
  const [typeShort, setTypeShort] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [expandedTypeId, setExpandedTypeId] = useState<string | null>(null);
  const [codesByType, setCodesByType] = useState<Record<string, ActivityCodeValue[]>>({});
  const [loadingCodes, setLoadingCodes] = useState<string | null>(null);
  const [codeDialog, setCodeDialog] = useState<{ typeId: string; open: boolean }>({ typeId: "", open: false });
  const [codeName, setCodeName] = useState("");
  const [codeShort, setCodeShort] = useState("");

  const loadTypes = async () => {
    if (!selectedProjectId || !mayRead) {
      setTypes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data } = await activityCodeTypesApi.list(selectedProjectId);
      setTypes(data);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load activity code types");
      setTypes([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadTypes();
  }, [selectedProjectId, mayRead]);

  const loadCodesForType = async (typeId: string) => {
    if (!selectedProjectId) return;
    setLoadingCodes(typeId);
    try {
      const { data } = await activityCodesApi.listByType(typeId, selectedProjectId);
      setCodesByType((prev) => ({ ...prev, [typeId]: data }));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load codes");
    } finally {
      setLoadingCodes(null);
    }
  };

  const toggleExpand = async (typeId: string) => {
    if (expandedTypeId === typeId) {
      setExpandedTypeId(null);
      return;
    }
    setExpandedTypeId(typeId);
    if (!codesByType[typeId]) await loadCodesForType(typeId);
  };

  const handleCreateType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !typeName.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await activityCodeTypesApi.create({
        projectId: selectedProjectId,
        name: typeName.trim(),
        slug: typeSlug.trim() || undefined,
        shortName: typeShort.trim() || null,
      });
      toast.success("Activity code type created");
      setTypeDialogOpen(false);
      setTypeName("");
      setTypeSlug("");
      setTypeShort("");
      await loadTypes();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create type");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteType = async (id: string) => {
    if (!selectedProjectId || !confirm("Delete this type and all its code values?")) return;
    try {
      await activityCodeTypesApi.delete(id, selectedProjectId);
      toast.success("Type deleted");
      if (expandedTypeId === id) setExpandedTypeId(null);
      await loadTypes();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete type");
    }
  };

  const handleCreateCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProjectId || !codeDialog.typeId || !codeName.trim()) {
      toast.error("Name is required");
      return;
    }
    const tid = codeDialog.typeId;
    setSubmitting(true);
    try {
      await activityCodesApi.create({
        projectId: selectedProjectId,
        typeId: tid,
        name: codeName.trim(),
        shortName: codeShort.trim() || null,
      });
      toast.success("Code value created");
      setCodeDialog({ typeId: "", open: false });
      setCodeName("");
      setCodeShort("");
      await loadCodesForType(tid);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteCode = async (typeId: string, codeId: string) => {
    if (!selectedProjectId || !confirm("Delete this code value?")) return;
    try {
      await activityCodesApi.delete(codeId, selectedProjectId);
      toast.success("Code deleted");
      await loadCodesForType(typeId);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete code");
    }
  };

  if (!selectedProjectId) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Activity codes</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Select a project to manage Primavera activity code types and values.</p>
      </div>
    );
  }

  if (!mayRead) {
    return (
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-white">Activity codes</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">You do not have permission to view activity codes for this project.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Activity codes</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Define P6 activity code types and values. Assign them on the Activities page; the export bundle defines codes in the XER and assigns them on the TASK spreadsheet via semantic columns (no TASKACTV sheet).
          </p>
        </div>
        {mayCreate ? (
          <Dialog open={typeDialogOpen} onOpenChange={setTypeDialogOpen}>
            <DialogTrigger asChild>
              <Button type="button">
                <Plus className="h-4 w-4" /> New type
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateType}>
                <DialogHeader>
                  <DialogTitle>New activity code type</DialogTitle>
                </DialogHeader>
                <div className="grid gap-3 py-4">
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                    <Input value={typeName} onChange={(e) => setTypeName(e.target.value)} placeholder="e.g. Phase" required />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Slug (optional)</label>
                    <Input value={typeSlug} onChange={(e) => setTypeSlug(e.target.value)} placeholder="auto from name if empty" />
                  </div>
                  <div className="grid gap-1">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Short name (optional)</label>
                    <Input value={typeShort} onChange={(e) => setTypeShort(e.target.value)} placeholder="P6 short label" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setTypeDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Types</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : types.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">No types yet. Create a type, then add code values.</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {types.map((t) => (
                <li key={t.id} className="py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => void toggleExpand(t.id)}
                      className="text-left font-medium text-slate-900 hover:underline dark:text-white"
                    >
                      {t.name}
                      <span className="ml-2 text-xs font-normal text-slate-500">({t.slug})</span>
                    </button>
                    <div className="flex items-center gap-2">
                      {mayCreate ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setCodeDialog({ typeId: t.id, open: true });
                            setCodeName("");
                            setCodeShort("");
                          }}
                        >
                          <Plus className="h-3 w-3" /> Code
                        </Button>
                      ) : null}
                      {mayDelete ? (
                        <Button type="button" variant="ghost" size="icon" onClick={() => void handleDeleteType(t.id)} title="Delete type">
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  {expandedTypeId === t.id ? (
                    <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-900">
                      {loadingCodes === t.id ? (
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      ) : (
                        <ul className="space-y-2">
                          {(codesByType[t.id] ?? []).map((c) => (
                            <li key={c.id} className="flex items-center justify-between gap-2">
                              <span>
                                {c.shortName || c.name}
                                <span className="ml-2 text-xs text-slate-500">{c.name}</span>
                              </span>
                              {mayDelete ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => void handleDeleteCode(t.id, c.id)}>
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              ) : null}
                            </li>
                          ))}
                          {(codesByType[t.id] ?? []).length === 0 ? <li className="text-slate-500">No values yet.</li> : null}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={codeDialog.open} onOpenChange={(o) => setCodeDialog((d) => ({ ...d, open: o }))}>
        <DialogContent>
          <form onSubmit={handleCreateCode}>
            <DialogHeader>
              <DialogTitle>New code value</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3 py-4">
              <div className="grid gap-1">
                <label className="text-sm font-medium">Name</label>
                <Input value={codeName} onChange={(e) => setCodeName(e.target.value)} required />
              </div>
              <div className="grid gap-1">
                <label className="text-sm font-medium">Short name (optional)</label>
                <Input value={codeShort} onChange={(e) => setCodeShort(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCodeDialog({ typeId: "", open: false })}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
