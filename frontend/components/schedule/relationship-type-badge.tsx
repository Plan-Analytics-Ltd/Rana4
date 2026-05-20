"use client";

import type { RelationshipType } from "@/lib/api";
import { cn } from "@/lib/utils";

const STYLES: Record<RelationshipType, string> = {
  FS: "bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-200",
  SS: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200",
  FF: "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  SF: "bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-200",
};

export function RelationshipTypeBadge(props: { type: RelationshipType; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex rounded px-1.5 py-0.5 font-mono text-xs font-semibold tracking-wide",
        STYLES[props.type],
        props.className
      )}
      title={`${props.type} relationship`}
    >
      {props.type}
    </span>
  );
}
