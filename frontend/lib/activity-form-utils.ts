import type { ActivityCodeAssignmentRow, ActivityCodeType } from "@/lib/api";

export type ActivityFormScope = "default" | "deliverable";

export const ACTIVITY_FORM_SCOPE_COPY: Record<
  ActivityFormScope,
  { basicDescription: string; codePlaceholder: string }
> = {
  default: {
    basicDescription: "Standard activity definition reused by every deliverable in this fragnet.",
    codePlaceholder: "e.g. INT_CHECK",
  },
  deliverable: {
    basicDescription: "Custom activity for one deliverable only.",
    codePlaceholder: "e.g. A100",
  },
};

/** Initialize P6 selects (one per type). */
export function emptyP6FormMap(types: ActivityCodeType[]): Record<string, string> {
  const next: Record<string, string> = {};
  for (const t of types) next[t.id] = "__NONE__";
  return next;
}

export function buildP6FormMapFromAssignments(
  rows: ActivityCodeAssignmentRow[] | undefined,
  types: ActivityCodeType[]
): Record<string, string> {
  const next = emptyP6FormMap(types);
  for (const row of rows ?? []) {
    next[row.typeId] = row.codeId;
  }
  return next;
}

/** Deliverable activity: deliverable defaults, then activity overrides. */
export function buildDeliverableActivityP6FormMap(
  activityAssignments: ActivityCodeAssignmentRow[] | undefined,
  deliverableAssignments: ActivityCodeAssignmentRow[] | undefined,
  types: ActivityCodeType[]
): Record<string, string> {
  const next = emptyP6FormMap(types);
  for (const row of deliverableAssignments ?? []) next[row.typeId] = row.codeId;
  for (const row of activityAssignments ?? []) next[row.typeId] = row.codeId;
  return next;
}

export function buildActivityCodePayload(
  formP6Codes: Record<string, string>,
  codeTypes: ActivityCodeType[],
  mode: "create" | "update",
  enabled: boolean
): Record<string, string | null> | undefined {
  if (!enabled || codeTypes.length === 0) return undefined;
  const out: Record<string, string | null> = {};
  let anySet = false;
  for (const t of codeTypes) {
    const v = formP6Codes[t.id];
    if (mode === "create") {
      if (v && v !== "__NONE__") {
        out[t.id] = v;
        anySet = true;
      }
    } else {
      out[t.id] = !v || v === "__NONE__" ? null : v;
    }
  }
  if (mode === "create" && !anySet) return undefined;
  return out;
}

export function parsePositiveDuration(value: string): number | null {
  if (value === "") return null;
  const n = parseInt(value, 10);
  if (!Number.isInteger(n) || n < 1) return null;
  return n;
}

export function validateActivityDefinitionFields(input: {
  activityCode: string;
  name: string;
  bestDuration: string;
  likelyDuration: string;
  deliverableId?: string;
  scope: ActivityFormScope;
}): string | null {
  if (input.scope === "deliverable" && !input.deliverableId) {
    return "Select a deliverable";
  }
  if (!input.activityCode.trim() || !input.name.trim()) {
    return "Activity code and name are required";
  }
  const best = parsePositiveDuration(input.bestDuration);
  const likely = parsePositiveDuration(input.likelyDuration);
  if (best === null || likely === null) {
    return "Best and likely duration must be positive integers";
  }
  return null;
}
