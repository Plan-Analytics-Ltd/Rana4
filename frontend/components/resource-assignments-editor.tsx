"use client";

import Link from "next/link";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { RateCardEntry } from "@/lib/api";

/** Sent to API: only type + name (+ optional units); server applies rate from card */
export type ResourceAssignmentDraft = {
  resourceType: string;
  resourceName: string;
  /** Optional override for export units (hours); empty = use default from duration */
  units: string;
};

type Props = {
  entries: RateCardEntry[] | null;
  value: ResourceAssignmentDraft[];
  onChange: (next: ResourceAssignmentDraft[]) => void;
  disabled?: boolean;
};

export function ResourceAssignmentsEditor({ entries, value, onChange, disabled }: Props) {
  const types = entries ? [...new Set(entries.map((e) => e.resourceType))].sort() : [];

  const namesForType = (t: string) =>
    (entries ?? []).filter((e) => e.resourceType === t).sort((a, b) => a.resourceName.localeCompare(b.resourceName));

  const labelFor = (e: RateCardEntry) => `${e.resourceName} (£${e.rate}/${e.unit})`;

  const keyOf = (type: string, name: string) => `${type}||${name}`;

  const enforceUniqueSelections = (rows: ResourceAssignmentDraft[]): ResourceAssignmentDraft[] => {
    const seen = new Set<string>();
    let changed = false;
    const out = rows.map((r) => {
      if (!r.resourceType || !r.resourceName) return r;
      const k = keyOf(r.resourceType, r.resourceName);
      if (seen.has(k)) {
        changed = true;
        return { ...r, resourceName: "" };
      }
      seen.add(k);
      return r;
    });
    return changed ? out : rows;
  };

  const addRow = () => {
    onChange(enforceUniqueSelections([...value, { resourceType: "", resourceName: "", units: "" }]));
  };

  const updateRow = (i: number, patch: Partial<ResourceAssignmentDraft>) => {
    const next = value.map((row, j) => (j === i ? { ...row, ...patch } : row));
    onChange(enforceUniqueSelections(next));
  };

  const removeRow = (i: number) => {
    onChange(value.filter((_, j) => j !== i));
  };

  if (!entries || entries.length === 0) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Rate card not loaded. Check API connection.
      </p>
    );
  }

  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Rates come from your uploaded rate card (open{" "}
        <Link href="/app/rate-card" className="font-medium text-cyan-600 underline-offset-2 hover:underline dark:text-cyan-400">
          Rate card
        </Link>{" "}
        in the sidebar). Upload a CSV or Excel file there first. Nothing is pre-assigned until you add a row.
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Resources</span>
        <Button type="button" variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={addRow} disabled={disabled || types.length === 0}>
          <Plus className="h-4 w-4" /> Add resource
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="text-xs text-slate-500 dark:text-slate-400">No resources assigned (optional).</p>
      ) : (
        <div className="space-y-3">
          {value.map((row, i) => {
            const options = row.resourceType ? namesForType(row.resourceType) : [];
            const selectedOther = new Set(
              value
                .filter((_, j) => j !== i)
                .filter((r) => r.resourceType && r.resourceName)
                .map((r) => keyOf(r.resourceType, r.resourceName))
            );
            const filteredOptions = options.filter((e) => !selectedOther.has(keyOf(e.resourceType, e.resourceName)));
            return (
              <div
                key={i}
                className="flex flex-col gap-3 rounded-md border border-slate-200 p-3 dark:border-slate-600"
              >
                <div className="grid min-w-0 gap-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400">Resource type</label>
                  <select
                    value={row.resourceType}
                    disabled={disabled}
                    onChange={(e) => {
                      const t = e.target.value;
                      updateRow(i, { resourceType: t, resourceName: "" });
                    }}
                    className={cn(
                      "h-9 w-full min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800",
                      "focus:outline-none focus:ring-2 focus:ring-slate-400"
                    )}
                  >
                    <option value="">Select type…</option>
                    {types.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid min-w-0 gap-1">
                  <label className="text-xs text-slate-600 dark:text-slate-400">Resource</label>
                  <select
                    value={row.resourceName}
                    disabled={disabled || !row.resourceType}
                    onChange={(e) => {
                      const nextName = e.target.value;
                      // Defensive: if a duplicate slips in (e.g. via fast edits), clear it.
                      if (nextName && selectedOther.has(keyOf(row.resourceType, nextName))) {
                        updateRow(i, { resourceName: "" });
                        return;
                      }
                      updateRow(i, { resourceName: nextName });
                    }}
                    className={cn(
                      "h-9 w-full min-w-0 max-w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800",
                      "focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                    )}
                  >
                    <option value="">{row.resourceType ? "Select…" : "Choose a type first"}</option>
                    {filteredOptions.map((e) => (
                      <option key={`${e.resourceType}-${e.resourceName}`} value={e.resourceName}>
                        {labelFor(e)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid min-w-0 gap-1 sm:grid-cols-[1fr_auto] sm:items-end sm:gap-3">
                  <div className="min-w-0">
                    <label className="text-xs text-slate-600 dark:text-slate-400">Units (optional)</label>
                    <Input
                      type="number"
                      min={0.01}
                      step="any"
                      placeholder="Auto (hours from duration)"
                      value={row.units}
                      disabled={disabled}
                      className="mt-1 w-full min-w-0"
                      onChange={(e) => updateRow(i, { units: e.target.value })}
                    />
                  </div>
                  <div className="flex justify-end sm:pb-0.5">
                    <Button type="button" variant="ghost" size="icon" onClick={() => removeRow(i)} disabled={disabled} aria-label="Remove resource">
                      <Trash2 className="h-4 w-4 text-slate-500" />
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function draftsToPayload(rows: ResourceAssignmentDraft[]): { resourceType: string; resourceName: string; units?: number }[] {
  const out: { resourceType: string; resourceName: string; units?: number }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r.resourceType || !r.resourceName) continue;
    const k = `${r.resourceType}||${r.resourceName}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const u = r.units.trim() === "" ? undefined : Number(r.units);
    if (u !== undefined && (!Number.isFinite(u) || u <= 0)) continue;
    out.push({
      resourceType: r.resourceType,
      resourceName: r.resourceName,
      ...(u !== undefined ? { units: u } : {}),
    });
  }
  return out;
}

export function storedToDrafts(
  stored: { resourceType: string; resourceName: string; units?: number }[] | null | undefined
): ResourceAssignmentDraft[] {
  if (!stored || !Array.isArray(stored)) return [];
  return stored.map((s) => ({
    resourceType: s.resourceType,
    resourceName: s.resourceName,
    units: s.units != null ? String(s.units) : "",
  }));
}
