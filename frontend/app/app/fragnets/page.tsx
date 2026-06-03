"use client";

import { useEffect, useState } from "react";
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
  type Standard,
  type Fragnet,
  getApiErrorMessage,
} from "@/lib/api";
import { useProject } from "@/contexts/project-context";
import { cn } from "@/lib/utils";
import { hasPermission } from "@/lib/project-permissions";
import { filterUserVisibleFragnets, filterUserVisibleStandards } from "@/lib/project-level-ui";

export default function FragnetsPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayEdit = hasPermission(selectedProjectRole, "fragnet", "update");
  const mayDelete = hasPermission(selectedProjectRole, "fragnet", "delete");
  const mayEditP6Codes = hasPermission(selectedProjectRole, "activityCode", "update");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [selectedStandardId, setSelectedStandardId] = useState<string>("");
  const [fragnets, setFragnets] = useState<Fragnet[]>([]);
  const [loadingStandards, setLoadingStandards] = useState(true);
  const [loadingFragnets, setLoadingFragnets] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchStandards = async () => {
    setLoadingStandards(true);
    try {
      if (!selectedProjectId) {
        setStandards([]);
        setSelectedStandardId("");
        return;
      }
      const { data } = await standardsApi.list(selectedProjectId);
      const visibleStandards = filterUserVisibleStandards(data);
      setStandards(visibleStandards);
      setSelectedStandardId((prev) =>
        prev && visibleStandards.some((standard) => standard.id === prev) ? prev : (visibleStandards[0]?.id ?? "")
      );
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load standards");
    } finally {
      setLoadingStandards(false);
    }
  };

  const fetchFragnets = async () => {
    if (!selectedStandardId) {
      setFragnets([]);
      return;
    }
    setLoadingFragnets(true);
    try {
      const { data } = await fragnetsApi.listByStandard(selectedStandardId);
      const visibleFragnets = filterUserVisibleFragnets(data);
      setFragnets(visibleFragnets);
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load fragnets");
      setFragnets([]);
    } finally {
      setLoadingFragnets(false);
    }
  };

  useEffect(() => {
    fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    fetchFragnets();
  }, [selectedStandardId]);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setEditId(null);
    setCreateOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim() || !selectedStandardId) {
      toast.error("Name and standard are required");
      return;
    }
    setSubmitting(true);
    try {
      await fragnetsApi.create({
        standardId: selectedStandardId,
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      toast.success("Fragnet created");
      resetForm();
      await fetchFragnets();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create fragnet");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId || !formName.trim()) return;
    setSubmitting(true);
    try {
      await fragnetsApi.update(editId, {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      toast.success("Fragnet updated");
      resetForm();
      await fetchFragnets();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update fragnet");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this fragnet? Activities and relationships will be removed.")) return;
    setDeletingId(id);
    try {
      await fragnetsApi.delete(id);
      toast.success("Fragnet deleted");
      await fetchFragnets();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete fragnet");
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (f: Fragnet) => {
    setEditId(f.id);
    setFormName(f.name);
    setFormDescription(f.description ?? "");
  };

  const selectedStandard = standards.find((s) => s.id === selectedStandardId);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Fragnets
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Fragment networks per standard.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select standard</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Choose a standard to view and manage its fragnets.
          </p>
        </CardHeader>
        <CardContent>
          {loadingStandards ? (
            <div className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading standards…
            </div>
          ) : standards.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              No standards yet. Create one on the Standards page first.
            </p>
          ) : (
            <select
              value={selectedStandardId}
              onChange={(e) => setSelectedStandardId(e.target.value)}
              className={cn(
                "flex h-9 w-full max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                "transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
              )}
            >
              {standards.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {selectedStandardId && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Fragnets for {selectedStandard?.name ?? "standard"}</CardTitle>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {fragnets.length} fragnet{fragnets.length !== 1 ? "s" : ""}
              </p>
            </div>
            <Dialog open={createOpen} onOpenChange={(open) => { setCreateOpen(open); if (!open) resetForm(); }}>
              {mayEdit ? (
                <DialogTrigger asChild>
                  <Button disabled={standards.length === 0}>
                    <Plus className="h-4 w-4" />
                    Create Fragnet
                  </Button>
                </DialogTrigger>
              ) : null}
              <DialogContent>
                <form onSubmit={handleCreate}>
                  <DialogHeader>
                    <DialogTitle>Create Fragnet</DialogTitle>
                  </DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label htmlFor="create-name" className="text-sm font-medium text-slate-700">
                        Name
                      </label>
                      <Input
                        id="create-name"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="Fragnet name"
                        required
                      />
                    </div>
                    <div className="grid gap-2">
                      <label htmlFor="create-desc" className="text-sm font-medium text-slate-700">
                        Description
                      </label>
                      <Input
                        id="create-desc"
                        value={formDescription}
                        onChange={(e) => setFormDescription(e.target.value)}
                        placeholder="Optional description"
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={submitting}>
                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                      Create
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {loadingFragnets ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
              </div>
            ) : fragnets.length === 0 ? (
              <p className="py-8 text-center text-slate-500 dark:text-slate-400">
                No fragnets for this standard. Create one to get started.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[120px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fragnets.map((f) => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.name}</TableCell>
                      <TableCell className="text-slate-500 dark:text-slate-400">{f.description || "—"}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          {mayEdit ? (
                            <Dialog
                              open={editId === f.id}
                              onOpenChange={(open) => { if (!open) resetForm(); else openEdit(f); }}
                            >
                              <DialogTrigger asChild>
                                <Button variant="outline" size="icon" type="button" onClick={() => openEdit(f)}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent>
                                <form onSubmit={handleUpdate}>
                                  <DialogHeader>
                                    <DialogTitle>Edit Fragnet</DialogTitle>
                                  </DialogHeader>
                                  <div className="grid gap-4 py-4">
                                    <div className="grid gap-2">
                                      <label htmlFor="edit-name" className="text-sm font-medium text-slate-700">Name</label>
                                      <Input
                                        id="edit-name"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        placeholder="Fragnet name"
                                        required
                                      />
                                    </div>
                                    <div className="grid gap-2">
                                      <label htmlFor="edit-desc" className="text-sm font-medium text-slate-700">Description</label>
                                      <Input
                                        id="edit-desc"
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        placeholder="Optional description"
                                      />
                                    </div>
                                  </div>
                                  <DialogFooter>
                                    <Button type="button" variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                                    <Button type="submit" disabled={submitting}>
                                      {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                                      Save
                                    </Button>
                                  </DialogFooter>
                                </form>
                              </DialogContent>
                            </Dialog>
                          ) : null}
                          {mayDelete ? (
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => handleDelete(f.id)}
                              disabled={deletingId === f.id}
                            >
                              {deletingId === f.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
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
      )}

    </div>
  );
}
