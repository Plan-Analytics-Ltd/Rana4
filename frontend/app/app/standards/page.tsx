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
import { standardsApi, assuranceNotesApi, type Standard, type AssuranceNote, getApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProject } from "@/contexts/project-context";
import { hasPermission } from "@/lib/project-permissions";
import { filterUserVisibleStandards } from "@/lib/project-level-ui";

export default function StandardsPage() {
  const { selectedProjectId, selectedProjectRole } = useProject();
  const mayEdit = hasPermission(selectedProjectRole, "standard", "update");
  const mayDelete = hasPermission(selectedProjectRole, "standard", "delete");
  const mayEditNotes = hasPermission(selectedProjectRole, "assuranceNote", "create");
  const mayDeleteNotes = hasPermission(selectedProjectRole, "assuranceNote", "delete");
  const [standards, setStandards] = useState<Standard[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [notesStandardId, setNotesStandardId] = useState<string>("");
  const [assuranceNotes, setAssuranceNotes] = useState<AssuranceNote[]>([]);
  const [loadingNotes, setLoadingNotes] = useState(false);
  const [noteDialogOpen, setNoteDialogOpen] = useState(false);
  const [formNoteText, setFormNoteText] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null);

  const fetchStandards = async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      if (!selectedProjectId) {
        setStandards([]);
        return;
      }
      const { data } = await standardsApi.list(selectedProjectId);
      setStandards(filterUserVisibleStandards(data));
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to load standards");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchAssuranceNotes = async () => {
    if (!notesStandardId) {
      setAssuranceNotes([]);
      return;
    }
    setLoadingNotes(true);
    try {
      const { data } = await assuranceNotesApi.listByStandard(notesStandardId);
      setAssuranceNotes(data);
    } catch {
      setAssuranceNotes([]);
    } finally {
      setLoadingNotes(false);
    }
  };

  useEffect(() => {
    fetchStandards();
  }, [selectedProjectId]);

  useEffect(() => {
    setNotesStandardId((prev) =>
      prev && standards.some((standard) => standard.id === prev) ? prev : (standards[0]?.id ?? "")
    );
  }, [standards]);

  useEffect(() => {
    fetchAssuranceNotes();
  }, [notesStandardId]);

  const resetForm = () => {
    setFormName("");
    setFormDescription("");
    setEditId(null);
    setCreateOpen(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Name is required");
      return;
    }
    setSubmitting(true);
    try {
      await standardsApi.create({
        projectId: selectedProjectId!,
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      toast.success("Standard created");
      resetForm();
      await fetchStandards({ silent: true });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to create standard");
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editId || !formName.trim()) return;
    setSubmitting(true);
    try {
      await standardsApi.update(editId, {
        name: formName.trim(),
        description: formDescription.trim() || undefined,
      });
      toast.success("Standard updated");
      resetForm();
      await fetchStandards({ silent: true });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to update standard");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this standard? This cannot be undone.")) return;
    setDeletingId(id);
    try {
      await standardsApi.delete(id);
      toast.success("Standard deleted");
      await fetchStandards({ silent: true });
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to delete standard");
    } finally {
      setDeletingId(null);
    }
  };

  const openEdit = (s: Standard) => {
    setEditId(s.id);
    setFormName(s.name);
    setFormDescription(s.description ?? "");
  };

  const handleCreateNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNoteText.trim() || !notesStandardId) return;
    setSubmittingNote(true);
    try {
      await assuranceNotesApi.create({ standardId: notesStandardId, noteText: formNoteText.trim() });
      toast.success("Assurance note added");
      setFormNoteText("");
      setNoteDialogOpen(false);
      await fetchAssuranceNotes();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to add note");
    } finally {
      setSubmittingNote(false);
    }
  };

  const handleDeleteNote = async (id: string) => {
    if (!confirm("Remove this assurance note?")) return;
    setDeletingNoteId(id);
    try {
      await assuranceNotesApi.delete(id);
      toast.success("Note removed");
      await fetchAssuranceNotes();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err) || "Failed to remove note");
    } finally {
      setDeletingNoteId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Standards
          </h2>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Create and manage scheduling standards.
          </p>
        </div>
        {mayEdit ? (
          <Dialog open={createOpen} onOpenChange={(open) => {
            setCreateOpen(open);
            if (!open) resetForm();
          }}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" />
                Create Standard
              </Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Create Standard</DialogTitle>
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
                      placeholder="Standard name"
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
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCreateOpen(false)}
                  >
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
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Standards</CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {standards.length} standard{standards.length !== 1 ? "s" : ""}
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : standards.length === 0 ? (
<p className="py-8 text-center text-slate-500 dark:text-slate-400">
            No standards yet. Create one to get started.
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
                {standards.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-slate-500 dark:text-slate-400">
                      {s.description || "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        {mayEdit ? (
                          <Dialog
                            open={editId === s.id}
                            onOpenChange={(open) => {
                              if (!open) resetForm();
                              else openEdit(s);
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                type="button"
                                onClick={() => openEdit(s)}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent>
                              <form onSubmit={handleUpdate}>
                                <DialogHeader>
                                  <DialogTitle>Edit Standard</DialogTitle>
                                </DialogHeader>
                                <div className="grid gap-4 py-4">
                                  <div className="grid gap-2">
                                    <label htmlFor="edit-name" className="text-sm font-medium text-slate-700">
                                      Name
                                    </label>
                                    <Input
                                      id="edit-name"
                                      value={formName}
                                      onChange={(e) => setFormName(e.target.value)}
                                      placeholder="Standard name"
                                      required
                                    />
                                  </div>
                                  <div className="grid gap-2">
                                    <label htmlFor="edit-desc" className="text-sm font-medium text-slate-700">
                                      Description
                                    </label>
                                    <Input
                                      id="edit-desc"
                                      value={formDescription}
                                      onChange={(e) => setFormDescription(e.target.value)}
                                      placeholder="Optional description"
                                    />
                                  </div>
                                </div>
                                <DialogFooter>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => setEditId(null)}
                                  >
                                    Cancel
                                  </Button>
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
                            onClick={() => handleDelete(s.id)}
                            disabled={deletingId === s.id}
                          >
                            {deletingId === s.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-red-600" />
                            )}
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

      {standards.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle>Assurance notes</CardTitle>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Notes for activities and deliverables. Select a standard to manage its notes.
              </p>
            </div>
            <Dialog open={noteDialogOpen} onOpenChange={(o) => { setNoteDialogOpen(o); if (!o) setFormNoteText(""); }}>
              {mayEditNotes ? (
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">Add note</Button>
                </DialogTrigger>
              ) : null}
              <DialogContent>
                <form onSubmit={handleCreateNote}>
                  <DialogHeader><DialogTitle>Add assurance note</DialogTitle></DialogHeader>
                  <div className="grid gap-4 py-4">
                    <div className="grid gap-2">
                      <label htmlFor="note-text" className="text-sm font-medium text-slate-700">Note text</label>
                      <Input
                        id="note-text"
                        value={formNoteText}
                        onChange={(e) => setFormNoteText(e.target.value)}
                        placeholder="Note content"
                        required
                      />
                    </div>
                  </div>
                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setNoteDialogOpen(false)}>Cancel</Button>
                    <Button type="submit" disabled={submittingNote || !notesStandardId}>
                      {submittingNote && <Loader2 className="h-4 w-4 animate-spin" />}
                      Add
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            <div className="mb-4">
              <label className="text-sm font-medium text-slate-700 dark:text-slate-300">Standard</label>
              <select
                value={notesStandardId}
                onChange={(e) => setNotesStandardId(e.target.value)}
                className={cn(
                  "mt-1 flex h-9 max-w-sm rounded-md border border-slate-200 bg-white px-3 py-1 text-sm shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100",
                  "focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                )}
              >
                {standards.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            {loadingNotes ? (
              <div className="flex items-center gap-2 py-4 text-slate-500 dark:text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading notes…
              </div>
            ) : assuranceNotes.length === 0 ? (
              <p className="py-4 text-sm text-slate-500 dark:text-slate-400">No assurance notes for this standard. Add one to use in activities or deliverables.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Note</TableHead>
                    <TableHead className="w-[80px] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assuranceNotes.map((n) => (
                    <TableRow key={n.id}>
                      <TableCell className="text-slate-700 dark:text-slate-200">{n.noteText}</TableCell>
                      <TableCell className="text-right">
                        {mayDeleteNotes ? (
                          <Button
                            variant="outline"
                            size="icon"
                            onClick={() => handleDeleteNote(n.id)}
                            disabled={deletingNoteId === n.id}
                          >
                            {deletingNoteId === n.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
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
      )}
    </div>
  );
}
