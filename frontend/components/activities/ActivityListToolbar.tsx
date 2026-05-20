"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fieldClass } from "@/components/schedule/form-section";
import {
  DEFAULT_ACTIVITY_FILTERS,
  type ActivityListFilters,
  type ActivityLinkFilter,
  type ActivityOwnershipFilter,
} from "@/lib/activity-list-filters";
import type { ActivityCodeType, Deliverable } from "@/lib/api";

export function ActivityListToolbar(props: {
  filters: ActivityListFilters;
  onChange: (next: ActivityListFilters) => void;
  deliverables: Deliverable[];
  codeTypes: ActivityCodeType[];
  totalCount: number;
  filteredCount: number;
}) {
  const { filters, onChange, deliverables, codeTypes, totalCount, filteredCount } = props;
  const selectedType = codeTypes.find((t) => t.id === filters.p6TypeId);

  const set = (patch: Partial<ActivityListFilters>) => onChange({ ...filters, ...patch });

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
          Filter activities
          <span className="ml-2 font-normal text-slate-500">
            {filteredCount === totalCount ? `${totalCount} shown` : `${filteredCount} of ${totalCount}`}
          </span>
        </p>
        <button
          type="button"
          className="text-xs font-medium text-slate-600 underline-offset-2 hover:underline dark:text-slate-400"
          onClick={() => onChange({ ...DEFAULT_ACTIVITY_FILTERS })}
        >
          Clear filters
        </button>
      </div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="h-10 pl-9"
          placeholder="Search code, name, deliverable, P6 codes…"
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Deliverable
          <select
            className={fieldClass}
            value={filters.deliverableId}
            onChange={(e) => set({ deliverableId: e.target.value })}
          >
            <option value="">All deliverables</option>
            {deliverables.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Ownership
          <select
            className={fieldClass}
            value={filters.ownership}
            onChange={(e) => set({ ownership: e.target.value as ActivityOwnershipFilter })}
          >
            <option value="all">All types</option>
            <option value="inherited">Inherited from fragnet</option>
            <option value="custom">Custom</option>
            <option value="detached">Detached</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Network
          <select
            className={fieldClass}
            value={filters.linkState}
            onChange={(e) => set({ linkState: e.target.value as ActivityLinkFilter })}
          >
            <option value="all">Any link state</option>
            <option value="linked">Has predecessors or successors</option>
            <option value="open_start">Open start (no predecessors)</option>
            <option value="open_finish">Open finish (no successors)</option>
            <option value="isolated">No links</option>
            <option value="missing_resources">Missing resources</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          P6 code type
          <select
            className={fieldClass}
            value={filters.p6TypeId}
            onChange={(e) => set({ p6TypeId: e.target.value, p6CodeId: "" })}
          >
            <option value="">Any type</option>
            {codeTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          P6 code value
          <select
            className={fieldClass}
            value={filters.p6CodeId}
            disabled={!filters.p6TypeId}
            onChange={(e) => set({ p6CodeId: e.target.value })}
          >
            <option value="">Any value</option>
            {(selectedType?.codes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortName || c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-slate-600 dark:text-slate-400">
          Resource
          <Input
            className="h-10"
            placeholder="Type or name…"
            value={filters.resourceQuery}
            onChange={(e) => set({ resourceQuery: e.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
