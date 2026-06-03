import type { ActivityCodeAssignmentRow, ActivityCodeType } from "@/lib/api";

export type ActivityFormScope = "default" | "deliverable";

export const ACTIVITY_FORM_SCOPE_COPY: Record<
  ActivityFormScope,
  { basicDescription: string; codePlaceholder: string }
> = {
  default: {
    basicDescription: "Workflow step applied to each deliverable (managed under Fragnets).",
    codePlaceholder: "e.g. INT_CHECK",
  },
  deliverable: {
    basicDescription:
      "New IDs continue after the last activity in the project schedule (all fragnets and deliverables in the database). Each ID must be unique.",
    codePlaceholder: "e.g. A1001",
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
  linkedDeliverableIds?: string[];
  isSharedAcrossDeliverables?: boolean;
  scope: ActivityFormScope;
  requireDeliverable?: boolean;
}): string | null {
  const requireDeliverable = input.requireDeliverable ?? input.scope === "deliverable";
  if (requireDeliverable && !input.deliverableId) {
    return "Select a deliverable";
  }
  if (input.isSharedAcrossDeliverables && requireDeliverable) {
    const linkedCount = new Set([input.deliverableId, ...(input.linkedDeliverableIds ?? [])].filter(Boolean)).size;
    if (linkedCount < 2) {
      return "Select at least two deliverables for a shared activity";
    }
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
