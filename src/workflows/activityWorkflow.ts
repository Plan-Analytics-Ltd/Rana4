export type ActivityStatus = "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "LOCKED";

export const transitions: Record<ActivityStatus, readonly ActivityStatus[]> = {
  DRAFT: ["PENDING_APPROVAL"],
  PENDING_APPROVAL: ["ACTIVE", "DRAFT"],
  ACTIVE: ["LOCKED"],
  LOCKED: [],
} as const;

export function canTransition(from: ActivityStatus, to: ActivityStatus): boolean {
  const allowed = transitions[from] ?? [];
  return allowed.includes(to);
}

export function allowedTransitions(from: ActivityStatus): readonly ActivityStatus[] {
  return transitions[from] ?? [];
}

