"use client";

import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ActivityBulkActionsBar(props: {
  selectedCount: number;
  onClear: () => void;
  onBulkDelete: () => void;
  busy: boolean;
  canDelete: boolean;
}) {
  const { selectedCount, onClear, onBulkDelete, busy, canDelete } = props;
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{selectedCount} selected</span>
      {canDelete && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onBulkDelete}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-600" />}
          Delete
        </Button>
      )}
      <Button type="button" size="sm" variant="ghost" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
