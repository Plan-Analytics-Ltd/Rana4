"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ActivityRow } from "./ActivityRow";

export function DeliverableNode(props: {
  deliverable: {
    id: string;
    name: string;
    activities: {
      id: string;
      activityCode: string;
      name: string;
      bestDuration: number;
      likelyDuration: number;
      assignedResources: unknown;
      relationships: { predecessors: any[]; successors: any[] };
    }[];
  };
}) {
  const [open, setOpen] = useState(false);
  const d = props.deliverable;

  return (
    <div className="pl-6">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-900"
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-medium">{d.name}</span>
        <span className="text-slate-500 dark:text-slate-400">({d.activities.length})</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2 pl-6">
          {d.activities.length === 0 ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No activities.</div>
          ) : (
            d.activities.map((a) => <ActivityRow key={a.id} activity={a as any} />)
          )}
        </div>
      )}
    </div>
  );
}

