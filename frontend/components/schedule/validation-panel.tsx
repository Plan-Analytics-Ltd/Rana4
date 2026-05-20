"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, AlertTriangle, ChevronDown, ChevronRight, Info, Lightbulb } from "lucide-react";
import {
  buildValidationDisplayGroups,
  type ValidationIssue,
  type ValidationSeverity,
} from "@/lib/schedule-validation";
import { cn } from "@/lib/utils";

const SECTIONS: {
  severity: ValidationSeverity;
  title: string;
  defaultOpen: boolean;
  icon: typeof AlertCircle;
}[] = [
  { severity: "critical", title: "Critical issues", defaultOpen: true, icon: AlertCircle },
  { severity: "warning", title: "Warnings", defaultOpen: true, icon: AlertTriangle },
  { severity: "advisory", title: "Advisory", defaultOpen: false, icon: Lightbulb },
  { severity: "info", title: "Info", defaultOpen: false, icon: Info },
];

const sectionStyles: Record<ValidationSeverity, string> = {
  critical: "border-red-200 bg-red-50/80 text-red-900 dark:border-red-900/50 dark:bg-red-950/25 dark:text-red-100",
  warning: "border-amber-200 bg-amber-50/80 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/25 dark:text-amber-100",
  advisory: "border-slate-200 bg-slate-50/80 text-slate-800 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200",
  info: "border-slate-200 bg-slate-50/60 text-slate-600 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
};

function ValidationSection(props: {
  severity: ValidationSeverity;
  title: string;
  defaultOpen: boolean;
  Icon: typeof AlertCircle;
  issues: ValidationIssue[];
  onIssueClick?: (issue: ValidationIssue) => void;
}) {
  const { severity, title, defaultOpen, Icon, issues, onIssueClick } = props;
  const [open, setOpen] = useState(defaultOpen);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  const sectionIssues = issues.filter((i) => i.severity === severity);
  const count = sectionIssues.length;
  const groups = buildValidationDisplayGroups(sectionIssues, severity);

  if (count === 0) return null;

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="shrink-0 rounded-md border border-slate-200 dark:border-slate-700">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-medium text-slate-900 dark:text-white"
      >
        <span className="flex min-w-0 items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
          <Icon className="h-4 w-4 shrink-0 opacity-80" />
          <span className="truncate">{title}</span>
        </span>
        <span className="shrink-0 rounded-full bg-slate-200/80 px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          {count}
        </span>
      </button>
      {open && (
        <ul className="max-h-48 space-y-1.5 overflow-y-auto overscroll-contain border-t border-slate-200 px-2 py-2 dark:border-slate-700">
          {groups.map((g) => {
            const expanded = expandedGroups.has(g.key);
            if (g.compressed) {
              return (
                <li key={g.key} className={cn("rounded-md border px-2.5 py-2 text-sm", sectionStyles[severity])}>
                  <button
                    type="button"
                    className="flex w-full items-start justify-between gap-2 text-left"
                    onClick={() => toggleGroup(g.key)}
                  >
                    <span className="min-w-0 flex-1 break-words font-medium">{g.title}</span>
                    {expanded ? (
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 shrink-0" />
                    )}
                  </button>
                  {expanded && g.issues.length > 1 && (
                    <ul className="mt-2 max-h-28 space-y-1 overflow-y-auto overscroll-contain border-t border-current/10 pt-2 text-xs opacity-90">
                      {g.issues.slice(0, 40).map((item) => (
                        <li key={item.id}>
                          <IssueLine item={item} onIssueClick={onIssueClick} compact />
                        </li>
                      ))}
                      {g.issues.length > 40 && (
                        <li className="italic opacity-70">…and {g.issues.length - 40} more</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            }
            const item = g.issues[0];
            return (
              <li key={g.key} className={cn("rounded-md border px-2.5 py-2 text-sm", sectionStyles[severity])}>
                <IssueLine item={item} onIssueClick={onIssueClick} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function IssueLine(props: {
  item: ValidationIssue;
  onIssueClick?: (issue: ValidationIssue) => void;
  compact?: boolean;
}) {
  const { item, onIssueClick, compact } = props;
  return (
    <div className={cn("min-w-0", compact ? "" : "space-y-0.5")}>
      <p className={cn("font-medium break-words", compact && "line-clamp-2")}>{item.message}</p>
      {item.entityLabel && (
        <p className={cn("text-xs opacity-80", compact ? "line-clamp-1" : "mt-0.5")}>{item.entityLabel}</p>
      )}
      <div className="mt-0.5 flex flex-wrap gap-2">
        {item.navigateHref && (
          <Link href={item.navigateHref} className="text-xs font-medium underline-offset-2 hover:underline">
            Go to fix →
          </Link>
        )}
        {onIssueClick && item.entityId && (
          <button
            type="button"
            className="text-xs font-medium underline-offset-2 hover:underline"
            onClick={() => onIssueClick(item)}
          >
            Highlight
          </button>
        )}
      </div>
    </div>
  );
}

export function ValidationPanel(props: {
  issues: ValidationIssue[];
  title?: string;
  emptyMessage?: string;
  className?: string;
  onIssueClick?: (issue: ValidationIssue) => void;
}) {
  const { issues, title = "Validation", emptyMessage = "No structural issues found.", className, onIssueClick } = props;

  const critical = issues.filter((i) => i.severity === "critical").length;
  const warning = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const info = issues.filter((i) => i.severity === "info").length;

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
        <div className="flex flex-wrap gap-1.5 text-xs">
          {critical > 0 && (
            <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium tabular-nums text-red-800 dark:bg-red-900/40 dark:text-red-200">
              {critical} critical
            </span>
          )}
          {warning > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium tabular-nums text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              {warning} warning{warning !== 1 ? "s" : ""}
            </span>
          )}
          {advisory > 0 && (
            <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium tabular-nums text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              {advisory} advisory
            </span>
          )}
          {info > 0 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-400">
              {info} info
            </span>
          )}
        </div>
      </div>
      {issues.length === 0 ? (
        <p className="shrink-0 text-sm text-emerald-700 dark:text-emerald-400">{emptyMessage}</p>
      ) : (
        <div className="min-h-0 max-h-[min(28rem,50vh)] space-y-2 overflow-y-auto overscroll-contain pr-0.5">
          {SECTIONS.map(({ severity, title: sectionTitle, defaultOpen, icon: SectionIcon }) => (
            <ValidationSection
              key={severity}
              severity={severity}
              title={sectionTitle}
              defaultOpen={defaultOpen}
              Icon={SectionIcon}
              issues={issues}
              onIssueClick={onIssueClick}
            />
          ))}
        </div>
      )}
    </div>
  );
}
