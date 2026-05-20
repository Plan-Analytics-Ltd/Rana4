"use client";

import { Link2, Unlink } from "lucide-react";
import { activityOwnershipKind } from "@/lib/schedule-effective";
import type { Activity } from "@/lib/api";
import type { ScheduleActivity } from "@/lib/schedule-types";
import { cn } from "@/lib/utils";

export function ActivityOwnershipBadge(props: {
  activity: Pick<Activity, "isInherited" | "detachedFromTemplate" | "templateActivityId"> | ScheduleActivity;
  className?: string;
}) {
  const kind = activityOwnershipKind(props.activity);
  if (kind === "inherited") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
          props.className
        )}
        title="Inherited from fragnet default activities"
      >
        <Link2 className="h-3 w-3" /> Inherited from fragnet
      </span>
    );
  }
  if (kind === "detached") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
          props.className
        )}
        title="Detached from fragnet defaults — no longer syncs"
      >
        <Unlink className="h-3 w-3" /> Detached
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300",
        props.className
      )}
    >
      Custom
    </span>
  );
}
