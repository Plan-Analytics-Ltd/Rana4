"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { fieldClass } from "@/components/schedule/form-section";
import { DEFAULT_ACTIVITY_FILTERS, type ActivityListFilters } from "@/lib/activity-list-filters";
export function ActivityListToolbar(props: {
  filters: ActivityListFilters;
  onChange: (next: ActivityListFilters) => void;
  totalCount: number;
  filteredCount: number;
}) {
  const { filters, onChange, totalCount, filteredCount } = props;

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="relative min-w-[200px] flex-1 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          className="h-9 pl-9"
          placeholder="Search code or name…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
        />
      </div>
      <p className="pb-1 text-xs text-slate-500 dark:text-slate-400">
        {filteredCount === totalCount ? `${totalCount} activities` : `${filteredCount} of ${totalCount}`}
        {filters.search ? (
          <button
            type="button"
            className="ml-2 underline-offset-2 hover:underline"
            onClick={() => onChange({ ...DEFAULT_ACTIVITY_FILTERS })}
          >
            Clear
          </button>
        ) : null}
      </p>
    </div>
  );
}
