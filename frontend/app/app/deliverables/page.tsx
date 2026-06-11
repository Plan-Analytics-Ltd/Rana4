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
  activityCodeTypesApi,
  rateCardApi,
  type Deliverable,
  type Standard,
  type Fragnet,
  type RateCardEntry,
  type ActivityCodeType,
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
import { cn } from "@/lib/utils";
import { ActivityBulkActionsBar } from "@/components/activities/ActivityBulkActionsBar";
import { filterUserVisibleFragnets, filterUserVisibleStandards } from "@/lib/project-level-ui";
import { DeliverableBenchmarkPanel } from "@/components/deliverables/deliverable-benchmark-panel";

type FragnetOption = { id: string; name: string; standardName?: string };

export default function DeliverablesPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const { query } = useSearch();
  const mayEdit = hasPermission(selectedProjectRole, "deliverable", "update");
  const mayDelete = hasPermission(selectedProjectRole, "deliverable", "delete");
  const mayEditP6Codes = hasPermission(selectedProjectRole, "activityCode", "update");
  const [deliverables, setDeliverables] = useState<Deliverable[]>([]);
  const [allFragnets, setAllFragnets] = useState<FragnetOption[]>([]);
  const [fragnetNameById, setFragnetNameById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [intelligenceRefreshKey, setIntelligenceRefreshKey] = useState(0);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formFragnetId, setFormFragnetId] = useState("");
  const [formName, setFormName] = useState("");
  const [formBestDuration, setFormBestDuration] = useState("");
  const [formLikelyDuration, setFormLikelyDuration] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [rateCardEntries, setRateCardEntries] = useState<RateCardEntry[] | null>(null);
  const [formResourceDrafts, setFormResourceDrafts] = useState<ResourceAssignmentDraft[]>([]);
  const [codeTypes, setCodeTypes] = useState<ActivityCodeType[]>([]);
  const [formP6Codes, setFormP6Codes] = useState<Record<string, string>>({});

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

  const loadInitialData = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (silent) setRefreshing(true);
    else setLoading(true);
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
      const standards: Standard[] = filterUserVisibleStandards(standardsRes.data);
      const deliverablesList: Deliverable[] = deliverablesRes.data;
      setDeliverables(deliverablesList);

      const fragnetLists = await Promise.all(
        standards.map((s) => fragnetsApi.listByStandard(s.id))
      );
      const fragnetsWithStandard: FragnetOption[] = filterUserVisibleFragnets(
        fragnetLists.flatMap((res, i) =>
        res.data.map((f: Fragnet) => ({
          id: f.id,
          name: f.name,
          standardName: standards[i]?.name,
        }))
      )
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
      if (silent) setRefreshing(false);
      else setLoading(false);
    }
  }, [selectedProjectId]);

  useEffect(() => {
    loadInitialData();
    setSelectedIds(new Set());
  }, [loadInitialData, selectedProjectId]);

  useEffect(() => {
    fetchCodeTypes();
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

  const refreshDeliverablesOnly = useCallback(async () => {
    if (!selectedProjectId) return;
    setRefreshing(true);
    try {
      const { data } = await deliverablesApi.list(selectedProjectId);
      setDeliverables(data);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to refresh deliverables");
    } finally {
      setRefreshing(false);
    }
  }, [selectedProjectId]);

  const fetchDeliverables = useCallback(
    () => refreshDeliverablesOnly(),
    [refreshDeliverablesOnly]
  );

  const resetForm = () => {
    setFormFragnetId("");
    setFormName("");
    setFormBestDuration("");
    setFormLikelyDuration("");
    setFormResourceDrafts([]);
    setFormP6Codes({});
    setEditId(null);
    setCreateOpen(false);
  };

  const buildDeliverableCodePayloadForCreate = (): Record<string, string | null> | undefined => {
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

  const buildDeliverableCodePayloadForUpdate = (): Record<string, string | null> | undefined => {
    if (!mayEditP6Codes || codeTypes.length === 0) return undefined;
    const out: Record<string, string | null> = {};
    for (const t of codeTypes) {
      const v = formP6Codes[t.id];
      out[t.id] = !v || v === "__NONE__" ? null : v;
    }
    return out;
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
        activityCodeByTypeId: buildDeliverableCodePayloadForCreate(),
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
        activityCodeByTypeId: buildDeliverableCodePayloadForUpdate(),
      });
      toast.success("Deliverable updated");
      setIntelligenceRefreshKey((k) => k + 1);
      await fetchDeliverables();
      resetForm();
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
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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
    const next: Record<string, string> = {};
    for (const t of codeTypes) next[t.id] = "__NONE__";
    for (const row of d.activityCodeAssignments ?? []) {
      next[row.typeId] = row.codeId;
    }
    setFormP6Codes(next);
  };

  const p6Snippet = (d: Deliverable) => {
    const rows = d.activityCodeAssignments ?? [];
    if (rows.length === 0) return "—";
    return rows.map((r) => `${r.type.name}: ${r.code.name}`).join("; ");
  };

  const normalizedQuery = query.trim().toLowerCase();
  const matchesQuery = useCallback(
    (d: Deliverable) => {
      if (!normalizedQuery) return true;
      const snip = p6Snippet(d).toLowerCase();
      return (
        d.id.toLowerCase().includes(normalizedQuery) ||
        d.name.toLowerCase().includes(normalizedQuery) ||
        snip.includes(normalizedQuery)
      );
    },
    [normalizedQuery]
  );

  const filteredDeliverables = deliverables.filter(matchesQuery);
  const unassignedDeliverables = filteredDeliverables.filter((d) => d.fragnetId == null);
  const assignedDeliverables = filteredDeliverables.filter((d) => d.fragnetId != null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllInList = (list: Deliverable[]) => {
    const ids = list.map((d) => d.id);
    const allSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSelected) ids.forEach((id) => next.delete(id));
      else ids.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (!confirm(`Delete ${ids.length} deliverable${ids.length === 1 ? "" : "s"}? Deliverables with activities cannot be deleted until those activities are removed.`)) {
      return;
    }
    setBulkBusy(true);
    let deleted = 0;
    const failed: string[] = [];
    try {
      for (const id of ids) {
        try {
          await deliverablesApi.delete(id);
          deleted += 1;
        } catch (err: unknown) {
          const name = deliverables.find((d) => d.id === id)?.name ?? id;
          failed.push(`${name}: ${getApiErrorMessage(err)}`);
        }
      }
      setSelectedIds(new Set());
      await fetchDeliverables();
      if (deleted > 0) {
        toast.success(`Deleted ${deleted} deliverable${deleted === 1 ? "" : "s"}`);
      }
      if (failed.length > 0) {
        toast.error(failed.length === ids.length ? failed[0]! : `${failed.length} failed:\n${failed.slice(0, 3).join("\n")}${failed.length > 3 ? "…" : ""}`);
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const openCreateUnassigned = () => {
    setFormFragnetId("");
    setFormResourceDrafts([]);
    setFormP6Codes({});
    setCreateOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">Deliverables</h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Create and edit deliverables; optionally assign to a fragnet or leave unassigned.
            {refreshing ? (
              <span className="ml-2 inline-flex items-center gap-1 text-slate-400">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                Updating…
              </span>
            ) : null}
          </p>
        </div>
      </div>

      {mayDelete && filteredDeliverables.length > 0 && (
        <ActivityBulkActionsBar
          selectedCount={selectedIds.size}
          onClear={() => setSelectedIds(new Set())}
          onBulkDelete={handleBulkDelete}
          busy={bulkBusy}
          canDelete={mayDelete}
        />
      )}

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
                  {mayDelete ? (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all unassigned"
                        checked={
                          unassignedDeliverables.length > 0 &&
                          unassignedDeliverables.every((d) => selectedIds.has(d.id))
                        }
                        onChange={() => toggleSelectAllInList(unassignedDeliverables)}
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Name</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead>Likely</TableHead>
                  <TableHead>P6 codes</TableHead>
                  <TableHead>Res.</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {unassignedDeliverables.map((d) => (
                  <TableRow key={d.id}>
                    {mayDelete ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${d.name}`}
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.bestDuration}</TableCell>
                    <TableCell>{d.likelyDuration}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-slate-600 dark:text-slate-400" title={p6Snippet(d)}>
                      {p6Snippet(d)}
                    </TableCell>
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
              if (o) {
                setFormResourceDrafts([]);
                setFormP6Codes({});
              } else resetForm();
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
                  {mayEditP6Codes && codeTypes.length > 0 ? (
                    <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                      <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Primavera activity codes</div>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Optional: one value per type. Export uses these on the deliverable TASK row; activities in the same block inherit unless they set their own value for that type.
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
                    durationDays={Math.max(0.01, Number(formBestDuration) || 1)}
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
              No deliverables match &quot;{query.trim()}&quot;. Try searching by ID, name, or P6 codes.
            </p>
          ) : assignedDeliverables.length === 0 ? (
            <p className="py-8 text-center text-slate-500 dark:text-slate-400">
              No fragnet-assigned deliverables match your search. See unassigned deliverables above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {mayDelete ? (
                    <TableHead className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all assigned"
                        checked={
                          assignedDeliverables.length > 0 &&
                          assignedDeliverables.every((d) => selectedIds.has(d.id))
                        }
                        onChange={() => toggleSelectAllInList(assignedDeliverables)}
                      />
                    </TableHead>
                  ) : null}
                  <TableHead>Name</TableHead>
                  <TableHead>Best</TableHead>
                  <TableHead>Likely</TableHead>
                  <TableHead>P6 codes</TableHead>
                  <TableHead>Fragnet</TableHead>
                  <TableHead>Res.</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignedDeliverables.map((d) => (
                  <TableRow key={d.id}>
                    {mayDelete ? (
                      <TableCell>
                        <input
                          type="checkbox"
                          aria-label={`Select ${d.name}`}
                          checked={selectedIds.has(d.id)}
                          onChange={() => toggleSelect(d.id)}
                        />
                      </TableCell>
                    ) : null}
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>{d.bestDuration}</TableCell>
                    <TableCell>{d.likelyDuration}</TableCell>
                    <TableCell className="max-w-[200px] truncate text-xs text-slate-600 dark:text-slate-400" title={p6Snippet(d)}>
                      {p6Snippet(d)}
                    </TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-400">{d.fragnetId ? (fragnetNameById[d.fragnetId] ?? d.fragnetId) : "—"}</TableCell>
                    <TableCell className="text-sm text-slate-600 dark:text-slate-400">{d.assignedResources?.length ?? 0}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {mayEdit ? (
                          <Button variant="outline" size="icon" type="button" onClick={() => openEdit(d)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
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

      {mayEdit ? (
        <Dialog open={editId != null} onOpenChange={(o) => { if (!o) resetForm(); }}>
          <DialogContent className="max-h-[min(90vh,900px)]">
            <form onSubmit={handleUpdate} className="min-w-0">
              <DialogHeader>
                <DialogTitle>Edit Deliverable</DialogTitle>
              </DialogHeader>
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
                <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="grid min-w-0 gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Best duration</label>
                    <Input
                      className="min-w-0"
                      type="number"
                      min={1}
                      value={formBestDuration}
                      onChange={(e) => setFormBestDuration(e.target.value)}
                    />
                  </div>
                  <div className="grid min-w-0 gap-2">
                    <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Likely duration</label>
                    <Input
                      className="min-w-0"
                      type="number"
                      min={1}
                      value={formLikelyDuration}
                      onChange={(e) => setFormLikelyDuration(e.target.value)}
                    />
                  </div>
                </div>
                {mayEditP6Codes && codeTypes.length > 0 ? (
                  <div className="space-y-3 rounded-md border border-slate-200 p-3 dark:border-slate-700">
                    <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Primavera activity codes</div>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Optional: one value per type. Export uses these on the deliverable TASK row; activities in the same block inherit unless they set their own value for that type.
                    </p>
                    {codeTypes.map((t) => (
                      <div key={t.id} className="grid gap-1">
                        <label className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                          {t.name}
                        </label>
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
                  durationDays={Math.max(0.01, Number(formBestDuration) || 1)}
                />
                {selectedProjectId && editId ? (
                  <DeliverableBenchmarkPanel
                    projectId={selectedProjectId}
                    deliverableId={editId}
                    enabled={editId != null}
                    refreshKey={intelligenceRefreshKey}
                  />
                ) : null}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => resetForm()}>
                  Cancel
                </Button>
                <Button type="submit" disabled={submitting}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Save
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
