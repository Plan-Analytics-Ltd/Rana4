"use client";

import { useMemo, useState } from "react";
import { Link2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { RelationshipTypeBadge } from "@/components/schedule/relationship-type-badge";
import { fieldClass } from "@/components/schedule/form-section";
import type { Activity, Relationship, RelationshipType } from "@/lib/api";
import { analyzeFragnetRelationshipGraph } from "@/lib/schedule-relationship-health";
import { validateFragnetRelationships } from "@/lib/schedule-validation";
import { cn } from "@/lib/utils";

const REL_TYPES: RelationshipType[] = ["FS", "SS", "FF", "SF"];

export function ActivityRelationshipsPanel(props: {
  activities: Activity[];
  relationships: Relationship[];
  loading: boolean;
  mayEdit: boolean;
  mayDelete: boolean;
  submitting: boolean;
  onCreate: (data: {
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: RelationshipType;
    lag: number;
  }) => Promise<void>;
  onUpdate: (
    id: string,
    data: { relationshipType?: RelationshipType; lag?: number }
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  activityLabel: (id: string) => string;
  filterActivityId?: string;
}) {
  const {
    activities,
    relationships,
    loading,
    mayEdit,
    mayDelete,
    submitting,
    onCreate,
    onUpdate,
    onDelete,
    activityLabel,
    filterActivityId,
  } = props;

  const [createOpen, setCreateOpen] = useState(false);
  const [editRelId, setEditRelId] = useState<string | null>(null);
  const [relFilter, setRelFilter] = useState("");
  const [predId, setPredId] = useState("");
  const [succId, setSuccId] = useState("");
  const [relType, setRelType] = useState<RelationshipType>("FS");
  const [relLag, setRelLag] = useState("0");
  const [editType, setEditType] = useState<RelationshipType>("FS");
  const [editLag, setEditLag] = useState("0");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const health = useMemo(
    () => analyzeFragnetRelationshipGraph(activities, relationships),
    [activities, relationships]
  );
  const relIssues = useMemo(
    () => validateFragnetRelationships(activities, relationships),
    [activities, relationships]
  );
  const badRelIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of relIssues) {
      if (i.entityType === "relationship" && i.entityId) ids.add(i.entityId);
    }
    return ids;
  }, [relIssues]);

  const filteredRels = useMemo(() => {
    let list = relationships;
    if (filterActivityId) {
      list = list.filter(
        (r) =>
          r.predecessorActivityId === filterActivityId || r.successorActivityId === filterActivityId
      );
    }
    const q = relFilter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((r) => {
      const pred = activityLabel(r.predecessorActivityId).toLowerCase();
      const succ = activityLabel(r.successorActivityId).toLowerCase();
      return pred.includes(q) || succ.includes(q) || r.relationshipType.toLowerCase().includes(q);
    });
  }, [relationships, relFilter, filterActivityId, activityLabel]);

  const resetCreate = () => {
    setPredId("");
    setSuccId("");
    setRelType("FS");
    setRelLag("0");
    setCreateOpen(false);
  };

  const openEdit = (r: Relationship) => {
    setEditRelId(r.id);
    setEditType(r.relationshipType);
    setEditLag(String(r.lag));
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!predId || !succId) {
      toast.error("Select predecessor and successor");
      return;
    }
    await onCreate({
      predecessorActivityId: predId,
      successorActivityId: succId,
      relationshipType: relType,
      lag: parseInt(relLag, 10) || 0,
    });
    resetCreate();
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editRelId) return;
    await onUpdate(editRelId, {
      relationshipType: editType,
      lag: parseInt(editLag, 10) || 0,
    });
    setEditRelId(null);
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-5 w-5" /> Relationships
          </CardTitle>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {relationships.length} link{relationships.length !== 1 ? "s" : ""}
            {health.activityCount > 0 && (
              <span className="ml-2">
                · Health <span className="font-medium text-slate-700 dark:text-slate-300">{health.healthScore}/100</span>
              </span>
            )}
          </p>
          {(health.openEnds.length > 0 || health.cyclePaths.length > 0) && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {health.openEnds.length > 0 && `${health.openEnds.length} open start`}
              {health.openEnds.length > 0 && health.cyclePaths.length > 0 && " · "}
              {health.cyclePaths.length > 0 && `${health.cyclePaths.length} cycle${health.cyclePaths.length !== 1 ? "s" : ""}`}
            </p>
          )}
        </div>
        {mayEdit && (
          <Dialog open={createOpen} onOpenChange={(o) => !o && resetCreate()}>
            <DialogTrigger asChild>
              <Button type="button" size="sm" disabled={activities.length < 2} onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" /> Add link
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[480px]">
              <form onSubmit={handleCreate}>
                <DialogHeader>
                  <DialogTitle>Add relationship</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <label className="grid gap-1 text-sm font-medium">
                    Predecessor
                    <select className={fieldClass} value={predId} onChange={(e) => setPredId(e.target.value)} required>
                      <option value="">Select…</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.activityCode} — {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-medium">
                    Successor
                    <select className={fieldClass} value={succId} onChange={(e) => setSuccId(e.target.value)} required>
                      <option value="">Select…</option>
                      {activities.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.activityCode} — {a.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="grid gap-1 text-sm font-medium">
                      Type
                      <select
                        className={fieldClass}
                        value={relType}
                        onChange={(e) => setRelType(e.target.value as RelationshipType)}
                      >
                        {REL_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="grid gap-1 text-sm font-medium">
                      Lag (days)
                      <Input className="h-10" type="number" value={relLag} onChange={(e) => setRelLag(e.target.value)} />
                    </label>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={resetCreate}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={submitting}>
                    {submitting && <Loader2 className="h-4 w-4 animate-spin" />} Add
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <Input
          className="h-10 max-w-md"
          placeholder="Filter by activity code…"
          value={relFilter}
          onChange={(e) => setRelFilter(e.target.value)}
        />
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : filteredRels.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">No relationships match.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Predecessor</TableHead>
                  <TableHead />
                  <TableHead>Successor</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Lag</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRels.map((r) => (
                  <TableRow
                    key={r.id}
                    className={cn(badRelIds.has(r.id) && "bg-red-50/80 dark:bg-red-950/20")}
                  >
                    <TableCell className="font-medium">{activityLabel(r.predecessorActivityId)}</TableCell>
                    <TableCell className="text-slate-400">→</TableCell>
                    <TableCell>{activityLabel(r.successorActivityId)}</TableCell>
                    <TableCell>
                      <RelationshipTypeBadge type={r.relationshipType} />
                    </TableCell>
                    <TableCell>
                      <span className="tabular-nums">{r.lag}d</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {mayEdit && (
                          <Button type="button" variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {mayDelete && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={deletingId === r.id}
                            onClick={async () => {
                              setDeletingId(r.id);
                              try {
                                await onDelete(r.id);
                              } finally {
                                setDeletingId(null);
                              }
                            }}
                          >
                            {deletingId === r.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4 text-red-600" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <Dialog open={editRelId !== null} onOpenChange={(o) => !o && setEditRelId(null)}>
        <DialogContent className="sm:max-w-[400px]">
          <form onSubmit={handleUpdate}>
            <DialogHeader>
              <DialogTitle>Edit relationship</DialogTitle>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-4">
              <label className="grid gap-1 text-sm font-medium">
                Type
                <select
                  className={fieldClass}
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as RelationshipType)}
                >
                  {REL_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-medium">
                Lag (days)
                <Input className="h-10" type="number" value={editLag} onChange={(e) => setEditLag(e.target.value)} />
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditRelId(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={submitting}>
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
