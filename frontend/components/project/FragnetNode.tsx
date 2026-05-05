"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { DeliverableNode } from "./DeliverableNode";

export function FragnetNode(props: {
  fragnet: {
    id: string;
    name: string;
    deliverables: {
      id: string;
      name: string;
      activities: any[];
    }[];
  };
}) {
  const [open, setOpen] = useState(false);
  const f = props.fragnet;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-base font-semibold text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-900"
      >
        {open ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        <span>{f.name}</span>
        <span className="text-sm font-normal text-slate-500 dark:text-slate-400">({f.deliverables.length})</span>
      </button>

      {open && (
        <div className="mt-2 space-y-2">
          {f.deliverables.length === 0 ? (
            <div className="pl-6 text-sm text-slate-500 dark:text-slate-400">No deliverables.</div>
          ) : (
            f.deliverables.map((d) => <DeliverableNode key={d.id} deliverable={d as any} />)
          )}
        </div>
      )}
    </div>
  );
}

