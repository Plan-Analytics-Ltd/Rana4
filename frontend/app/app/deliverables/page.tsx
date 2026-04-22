"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Loader2 } from "lucide-react";
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
  rateCardApi,
  type Deliverable,
  type Standard,
  type Fragnet,
  type RateCardEntry,
  getApiErrorMessage,
} from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { useSearch } from "@/contexts/search-context";
import {
  ResourceAssignmentsEditor,
  draftsToPayload,
  storedToDrafts,
  type ResourceAssignmentDraft,
} from "@/components/resource-assignments-editor";
import { hasPermission } from "@/lib/project-permissions";

type FragnetOption = { id: string; name: string; standardName?: string };

export default function DeliverablesPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const { query } = useSearch();
  const mayEdit = hasPermission(selectedProjectRole, "deliverable", "update");
  const mayDelete = hasPermission(selectedProjectRole, "deliverable", "delete");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [allFragnets, setAllFragnets] = useState<FragnetOption[]>([]);
  const [fragnetNameById, setFragnetNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formFragnetId, setFormFragnetId] = useState("");
  const [formName, setFormName] = useState("");
  const [formBestDuration, setFormBestDuration] = useState("");
  const [formLikelyDuration, setFormLikelyDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedProjectId) {
        setDeliverables([]);
        setAllFragnets([]);
        setFragnetNameById({});
        return;
      }
      const [standardsRes, deliverablesRes] = await Promise.all([
        standardsApi.list(selectedProjectId),
        deliverablesApi.list(selectedProjectId),
      ]);
      const standards: Standard[] = standardsRes.data;
      const deliverablesList: Deliverable[] = deliverablesRes.data;
      setDeliverables(deliverablesList);

      const fragnetLists = await Promise.all(
        standards.map((s) => fragnetsApi.listByStandard(s.id))
      );
      const fragnetsWithStandard: FragnetOption[] = fragnetLists.flatMap((res, i) =>
        res.data.map((f: Fragnet) => ({
          id: f.id,
          name: f.name,
          standardName: standards[i]?.name,
        }))
      );
      setAllFragnets(fragnetsWithStandard);
      const nameById: Record<string, string> = {};
      fragnetsWithStandard.forEach((f) => {
        nameById[f.id] = f.standardName ? `${f.name} (${f.standardName})` : f.name;
      });
      setFragnetNameById(nameById);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load deliverables");
      setDeliverables([]);
      setAllFragnets([]);
      setFragnetNameById({});
    } finally {
      setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData, selectedProjectId]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await rateCardApi.get();
        setRateCardEntries(data.entries);
      } catch {
        setRateCardEntries([]);
      }
    })();
  }, []);

  const fetchDeliverables = useCallback(() => loadInitialData(), [loadInitialData]);

  const resetForm = () => {
    setFormFragnetId("");
    setFormName("");
    setFormBestDuration("");
    setFormLikelyDuration("");
    setFormResourceDrafts([]);
    setEditId(null);
    setCreateOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const best = parseInt(formBestDuration, 10);
    const likely = parseInt(formLikelyDuration, 10);
    if (!formName.trim() || !Number.isInteger(best) || best < 1 || !Number.isInteger(likely) || likely < 1) {
      toast.error("Name and positive durations are required");
      return;
    }
    setSubmitting(true);
    try {
      await deliverablesApi.create({
        projectId: selectedProjectId!,
        ...(formFragnetId.trim() && { fragnetId: formFragnetId.trim() }),
        name: formName.trim(),
        bestDuration: best,
        likelyDuration: likely,
        assignedResources: draftsToPayload(formResourceDrafts),
      });
      toast.success("Deliverable created");
      resetForm();
      await fetchDeliverables();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create deliverable");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId) return;
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
    setSubmitting(true);
    try {
      await deliverablesApi.update(editId, {
        fragnetId: formFragnetId.trim() || null,
        name: formName.trim() || undefined,
        bestDuration: best,
        likelyDuration: likely,
        assignedResources: draftsToPayload(formResourceDrafts),
      });
      toast.success("Deliverable updated");
      resetForm();
      await fetchDeliverables();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update deliverable");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this deliverable?")) return;
    setDeletingId(id);
    try {
      await deliverablesApi.delete(id);
      toast.success("Deliverable deleted");
      await fetchDeliverables();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete deliverable");
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (d: Deliverable) => {
    setEditId(d.id);
    setFormFragnetId(d.fragnetId ?? "");
    setFormName(d.name);
    setFormBestDuration(String(d.bestDuration));
    setFormLikelyDuration(String(d.likelyDuration));
    setFormResourceDrafts(storedToDrafts(d.assignedResources));
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (d: Deliverable) => {
      if (!normalizedQuery) return true;
      return d.id.toLowerCase().includes(normalizedQuery) || d.name.toLowerCase().includes(normalizedQuery);
    },
    [normalizedQuery]
  );

  const filteredDeliverables = deliverables.filter(matchesQuery);
  const unassignedDeliverables = filteredDeliverables.filter((d) => d.fragnetId == null);
  const openCreateUnassigned = () => {
    setFormFragnetId("");
    setFormResourceDrafts([]);
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Deliverables</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Create and edit deliverables; optionally assign to a fragnet or leave unassigned.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle>Unassigned deliverables (no fragnet)</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {normalizedQuery
                ? `${unassignedDeliverables.length} shown (filtered from ${deliverables.filter((d) => d.fragnetId == null).length})`
                : `${unassignedDeliverables.length} deliverable${unassignedDeliverables.length !== 1 ? "s" : ""} not assigned to any fragnet`}
              . You can include these in exports from the Export page.
            </p>
          </div>
          {mayEdit ? (
            <Button variant="outline" onClick={openCreateUnassigned} disabled={loading}>
              <Plus className="h-4 w-4" /> Create unassigned deliverable
            </Button>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>
          ) : unassignedDeliverables.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">No unassigned deliverables. Create one above or assign a deliverable to &quot;No fragnet&quot; in the table below.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead>Likely</TableHead>
                  <TableHead>Res.</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedDeliverables.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.bestDuration}</TableCell>
                    <TableCell>{d.likelyDuration}</TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">{d.assignedResources?.length ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {mayEdit ? (
                          <Button variant="outline" size="icon" type="button" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                        ) : null}
                        {mayDelete ? (
                          <Button variant="outline" size="icon" onClick={() => handleDelete(d.id)} disabled={deletingId === d.id}>
                            {deletingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                          </Button>
                        ) : null}
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
            <CardTitle>Deliverables</CardTitle>
            <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
              {normalizedQuery
                ? `${filteredDeliverables.length} shown (filtered from ${deliverables.length})`
                : `${deliverables.length} deliverable${deliverables.length !== 1 ? "s" : ""}`}
            </p>
          </div>
          <Dialog
            open={createOpen}
            onOpenChange={(o) => {
              setCreateOpen(o);
              if (o) setFormResourceDrafts([]);
              else resetForm();
            }}
          >
            {mayEdit ? (
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4" /> Create Deliverable
                </Button>
              </DialogTrigger>
            ) : null}
            <DialogContent>
              <form onSubmit={handleCreate} className="min-w-0">
                <DialogHeader><DialogTitle>Create Deliverable</DialogTitle></DialogHeader>
                <div className="grid min-w-0 gap-4 py-4">
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Fragnet (optional)</label>
                    <select
                      value={formFragnetId}
                      onChange={(e) => setFormFragnetId(e.target.value)}
                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    >
                      <option value="">No fragnet</option>
                      {allFragnets.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.standardName ? `${f.name} (${f.standardName})` : f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                    <Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="Deliverable name" required />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Best duration</label>
                      <Input type="number" min={1} value={formBestDuration} onChange={(e) => setFormBestDuration(e.target.value)} required />
                    </div>
                    <div className="grid gap-2">
                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Likely duration</label>
                      <Input type="number" min={1} value={formLikelyDuration} onChange={(e) => setFormLikelyDuration(e.target.value)} required />
                    </div>
                  </div>
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
          {loading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-slate-400" /></div>
          ) : deliverables.length === 0 ? (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400">No deliverables yet. Create one (with or without a fragnet).</p>
          ) : filteredDeliverables.length === 0 ? (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400">
              No deliverables match &quot;{query.trim()}&quot;. Try searching by ID or name.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead>Likely</TableHead>
                  <TableHead>Fragnet</TableHead>
                  <TableHead>Res.</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDeliverables.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.bestDuration}</TableCell>
                    <TableCell>{d.likelyDuration}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{d.fragnetId ? (fragnetNameById[d.fragnetId] ?? d.fragnetId) : "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">{d.assignedResources?.length ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {mayEdit ? (
                          <Dialog open={editId === d.id} onOpenChange={(o) => { if (!o) resetForm(); else openEdit(d); }}>
                            <DialogTrigger asChild>
                              <Button variant="outline" size="icon" type="button" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></Button>
                            </DialogTrigger>
                            <DialogContent>
                              <form onSubmit={handleUpdate} className="min-w-0">
                                <DialogHeader><DialogTitle>Edit Deliverable</DialogTitle></DialogHeader>
                                <div className="grid min-w-0 gap-4 py-4">
                                  <div className="grid gap-2">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Fragnet (optional)</label>
                                    <select
                                      value={formFragnetId}
                                      onChange={(e) => setFormFragnetId(e.target.value)}
                                      className="flex h-9 w-full rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-950 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                                    >
                                      <option value="">No fragnet</option>
                                      {allFragnets.map((f) => (
                                        <option key={f.id} value={f.id}>
                                          {f.standardName ? `${f.name} (${f.standardName})` : f.name}
                                        </option>
                                      ))}
                                    </select>
                                  </div>
                                  <div className="grid gap-2">
                                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Name</label>
                                    <Input value={formName} onChange={(e) => setFormName(e.target.value)} required />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="grid gap-2">
                                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Best duration</label>
                                      <Input type="number" min={1} value={formBestDuration} onChange={(e) => setFormBestDuration(e.target.value)} />
                                    </div>
                                    <div className="grid gap-2">
                                      <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Likely duration</label>
                                      <Input type="number" min={1} value={formLikelyDuration} onChange={(e) => setFormLikelyDuration(e.target.value)} />
                                    </div>
                                  </div>
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
                        ) : null}
                        {mayDelete ? (
                          <Button variant="outline" size="icon" onClick={() => handleDelete(d.id)} disabled={deletingId === d.id}>
                            {deletingId === d.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
                          </Button>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
