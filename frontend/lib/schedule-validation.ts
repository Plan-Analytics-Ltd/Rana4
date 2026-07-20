import type { Activity, RateCardEntry, Relationship } from "@/lib/api";
import { validateFragnetRelationshipHealth } from "@/lib/schedule-relationship-health";
import { type ProjectFullData, rateCardLookup, type ScheduleActivity } from "@/lib/schedule-types";
import { isP6MilestoneType } from "@/lib/p6TaskType";
import {
  deliverableHasEffectiveWorkflow,
  deliverableNeedsMaterialization,
  getEffectiveActivityCount,
} from "@/lib/schedule-effective";

/** Structural / export health severity (not cosmetic). */
export type ValidationSeverity = "critical" | "warning" | "advisory" | "info";

export type ValidationIssue = {
  id: string;
  severity: ValidationSeverity;
  code: string;
  message: string;
  entityType?: "project" | "fragnet" | "deliverable" | "activity" | "relationship" | "resource";
  entityId?: string;
  entityLabel?: string;
  navigateHref?: string;
};

const SEVERITY_ORDER: Record<ValidationSeverity, number> = {
  critical: 0,
  warning: 1,
  advisory: 2,
  info: 3,
};

/** Per-issue-code penalty (first hit + diminishing extras), capped per code. */
const CODE_SCORE_RULES: Record<
  string,
  { severity: ValidationSeverity; first: number; extra: number; cap: number }
> = {
  INVALID_DURATION: { severity: "critical", first: 22, extra: 8, cap: 40 },
  ORPHAN_PRED: { severity: "critical", first: 20, extra: 6, cap: 35 },
  DUPLICATE_RELATIONSHIP: { severity: "critical", first: 18, extra: 5, cap: 30 },
  SELF_LINK: { severity: "critical", first: 25, extra: 0, cap: 25 },
  DUPLICATE_TASK_CODE: { severity: "critical", first: 20, extra: 8, cap: 38 },
  ORPHAN_RELATIONSHIP: { severity: "critical", first: 22, extra: 6, cap: 35 },
  CYCLE: { severity: "critical", first: 28, extra: 10, cap: 45 },
  CPM_CYCLE: { severity: "critical", first: 28, extra: 10, cap: 45 },
  NEGATIVE_FLOAT: { severity: "critical", first: 20, extra: 6, cap: 35 },
  IMPOSSIBLE_DATES: { severity: "critical", first: 22, extra: 6, cap: 35 },
  NO_RATE_CARD: { severity: "critical", first: 15, extra: 0, cap: 15 },

  MISSING_RATE: { severity: "warning", first: 6, extra: 2, cap: 18 },
  INVALID_UNITS: { severity: "warning", first: 5, extra: 2, cap: 14 },
  NO_RATE_CARD_EMPTY: { severity: "warning", first: 4, extra: 0, cap: 4 },
  ISOLATED_ACTIVITY: { severity: "warning", first: 4, extra: 1, cap: 12 },
  OPEN_END: { severity: "warning", first: 5, extra: 2, cap: 12 },
  DANGLING_LOGIC: { severity: "warning", first: 5, extra: 2, cap: 12 },
  ISOLATED_NETWORK: { severity: "warning", first: 8, extra: 3, cap: 14 },
  INVALID_LAG: { severity: "warning", first: 4, extra: 2, cap: 10 },
  RELATIONSHIP_HEALTH: { severity: "advisory", first: 2, extra: 0, cap: 2 },
  EMPTY_DELIVERABLE: { severity: "warning", first: 5, extra: 2, cap: 12 },

  DUPLICATE_DELIVERABLE_NAME: { severity: "advisory", first: 0.4, extra: 0.15, cap: 2 },
  NO_ASSIGNMENTS: { severity: "advisory", first: 0.3, extra: 0.08, cap: 4 },
  SPARSE_SCHEDULE: { severity: "advisory", first: 0.5, extra: 0, cap: 0.5 },
  LONG_ACTIVITY_NAME: { severity: "advisory", first: 0.2, extra: 0.05, cap: 1 },
};

const DEFAULT_RULE: Record<ValidationSeverity, { first: number; extra: number; cap: number }> = {
  critical: { first: 18, extra: 6, cap: 30 },
  warning: { first: 5, extra: 2, cap: 12 },
  advisory: { first: 0.4, extra: 0.1, cap: 2 },
  info: { first: 0, extra: 0, cap: 0 },
};

function issue(
  severity: ValidationSeverity,
  code: string,
  message: string,
  extra?: Partial<ValidationIssue>
): ValidationIssue {
  return {
    id: `${code}-${extra?.entityId ?? "global"}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    code,
    message,
    ...extra,
  };
}

function penaltyForCode(code: string, count: number): number {
  const rule = CODE_SCORE_RULES[code];
  const sev = rule?.severity ?? "warning";
  const { first, extra, cap } = rule ?? DEFAULT_RULE[sev];
  if (count <= 0) return 0;
  const raw = first + Math.max(0, count - 1) * extra;
  return Math.min(cap, raw);
}

export type ReadinessResult = {
  score: number;
  band: string;
  label: string;
  critical: number;
  warning: number;
  advisory: number;
  info: number;
  /** Alias for export gating — only critical issues block by default */
  blocking: number;
};

export function readinessBand(score: number): { band: string; label: string } {
  if (score >= 90) return { band: "excellent", label: "Excellent" };
  if (score >= 80) return { band: "good", label: "Good" };
  if (score >= 65) return { band: "usable", label: "Usable" };
  if (score >= 45) return { band: "risky", label: "Risky" };
  return { band: "unstable", label: "Unstable" };
}

/** Template health score 0–100 — structural / export readiness, not advisory noise. */
export function readinessScore(issues: ValidationIssue[]): ReadinessResult {
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warning = issues.filter((i) => i.severity === "warning").length;
  const advisory = issues.filter((i) => i.severity === "advisory").length;
  const info = issues.filter((i) => i.severity === "info").length;

  const byCode = new Map<string, number>();
  for (const i of issues) {
    byCode.set(i.code, (byCode.get(i.code) ?? 0) + 1);
  }

  let deduction = 0;
  for (const [code, count] of byCode) {
    deduction += penaltyForCode(code, count);
  }

  let score = Math.round(100 - deduction);
  if (score < 0) score = 0;
  if (score > 100) score = 100;

  const { band, label } = readinessBand(score);
  return { score, band, label, critical, warning, advisory, info, blocking: critical };
}

/** Codes that should render as one compressed summary row in the UI. */
export const COMPRESSIBLE_CODES = new Set([
  "NO_ASSIGNMENTS",
  "DUPLICATE_DELIVERABLE_NAME",
  "ISOLATED_ACTIVITY",
  "MISSING_RATE",
  "INVALID_UNITS",
  "LONG_ACTIVITY_NAME",
  "ORPHAN_PRED",
  "EMPTY_DELIVERABLE",
  "PENDING_MATERIALIZATION",
]);

const COMPRESS_TITLES: Record<string, (count: number) => string> = {
  NO_ASSIGNMENTS: (n) => `Activities without resources (${n} ${n === 1 ? "activity" : "activities"})`,
  DUPLICATE_DELIVERABLE_NAME: (n) => `Duplicate deliverable names (${n} ${n === 1 ? "instance" : "instances"})`,
  ISOLATED_ACTIVITY: (n) => `Activities without predecessors or successors (${n})`,
  MISSING_RATE: (n) => `Assignments missing rate card match (${n})`,
  INVALID_UNITS: (n) => `Invalid resource units (${n})`,
  LONG_ACTIVITY_NAME: (n) => `Long activity names (${n})`,
  ORPHAN_PRED: (n) => `Broken predecessor references (${n})`,
  EMPTY_DELIVERABLE: () => "Empty deliverables",
  PENDING_MATERIALIZATION: () => "Default activities not yet applied",
};

export { getEffectiveActivityCount, deliverableHasEffectiveWorkflow, deliverableNeedsMaterialization };

export type ValidationDisplayGroup = {
  key: string;
  severity: ValidationSeverity;
  code: string;
  title: string;
  count: number;
  compressed: boolean;
  issues: ValidationIssue[];
};

export function buildValidationDisplayGroups(
  issues: ValidationIssue[],
  severity: ValidationSeverity
): ValidationDisplayGroup[] {
  const subset = issues.filter((i) => i.severity === severity);
  const byCode = new Map<string, ValidationIssue[]>();
  for (const i of subset) {
    const list = byCode.get(i.code) ?? [];
    list.push(i);
    byCode.set(i.code, list);
  }

  const groups: ValidationDisplayGroup[] = [];
  const compressInSection =
    severity === "advisory" || severity === "info" || severity === "warning" || severity === "critical";

  for (const [code, list] of byCode) {
    const alwaysCompress = code === "EMPTY_DELIVERABLE" || code === "PENDING_MATERIALIZATION";
    const shouldCompress =
      compressInSection && COMPRESSIBLE_CODES.has(code) && (alwaysCompress || list.length >= 2);
    if (shouldCompress) {
      const titleFn = COMPRESS_TITLES[code];
      groups.push({
        key: `${severity}-${code}`,
        severity,
        code,
        title: titleFn ? titleFn(list.length) : `${code} (${list.length})`,
        count: list.length,
        compressed: true,
        issues: list,
      });
    } else {
      for (const i of list) {
        groups.push({
          key: i.id,
          severity,
          code,
          title: i.message,
          count: 1,
          compressed: false,
          issues: [i],
        });
      }
    }
  }

  return groups;
}

/** Whether an activity passes duration validation for export/schedule readiness. */
export function isActivityDurationValid(
  activity: Pick<ScheduleActivity, "bestDuration" | "likelyDuration" | "p6TaskType">,
  scenario: "best" | "likely"
): boolean {
  const raw = scenario === "best" ? activity.bestDuration : activity.likelyDuration;
  if (!Number.isFinite(raw) || raw < 0) return false;
  if (isP6MilestoneType(activity.p6TaskType)) return true;
  return raw > 0;
}

/** Validate project tree for planner/export readiness (client-side). */
export function validateProjectSchedule(
  data: ProjectFullData,
  rateCard: RateCardEntry[],
  scenario: "best" | "likely" = "best"
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const lookup = rateCardLookup(rateCard);
  const codeToActivityId = new Map<string, string>();
  const deliverableNames = new Map<string, string[]>();
  let totalActivities = 0;
  let withResources = 0;
  let withRelationships = 0;
  let emptyDeliverableCount = 0;
  let pendingMaterializationCount = 0;

  for (const f of data.fragnets) {
    const templateCount = f.activityTemplateCount ?? 0;

    for (const d of f.deliverables) {
      const names = deliverableNames.get(d.name.trim().toLowerCase()) ?? [];
      names.push(d.id);
      deliverableNames.set(d.name.trim().toLowerCase(), names);

      if (!deliverableHasEffectiveWorkflow(d, templateCount, f)) {
        emptyDeliverableCount++;
      } else if (deliverableNeedsMaterialization(d, templateCount)) {
        pendingMaterializationCount++;
      }

      for (const a of d.activities) {
        totalActivities++;
        const code = a.activityCode.trim();
        codeToActivityId.set(code, a.id);

        if (!isActivityDurationValid(a, scenario)) {
          issues.push(
            issue("critical", "INVALID_DURATION", `Activity ${code} has no valid ${scenario} duration`, {
              entityType: "activity",
              entityId: a.id,
              entityLabel: `${code} — ${a.name}`,
              navigateHref: "/app/activities",
            })
          );
        }

        if (!code) {
          issues.push(
            issue("critical", "INVALID_DURATION", "Activity missing activity code / ID", {
              entityType: "activity",
              entityId: a.id,
              entityLabel: a.name,
            })
          );
        }

        if (a.name.length > 120) {
          issues.push(
            issue("advisory", "LONG_ACTIVITY_NAME", `Long name on ${code}`, {
              entityType: "activity",
              entityId: a.id,
              entityLabel: code,
            })
          );
        }

        for (const ar of a.assignedResources) {
          const k = `${ar.resourceType.trim().toLowerCase()}|${ar.resourceName.trim().toLowerCase()}`;
          if (rateCard.length > 0 && !lookup.has(k)) {
            issues.push(
              issue("warning", "MISSING_RATE", `Resource "${ar.resourceName}" (${ar.resourceType}) not on rate card`, {
                entityType: "resource",
                entityId: a.id,
                entityLabel: code,
                navigateHref: "/app/rate-card",
              })
            );
          }
          if (ar.units != null && (!Number.isFinite(ar.units) || ar.units <= 0)) {
            issues.push(
              issue("warning", "INVALID_UNITS", `Invalid units on ${code} for ${ar.resourceName}`, {
                entityType: "activity",
                entityId: a.id,
                entityLabel: code,
              })
            );
          }
        }

        if (a.assignedResources.length > 0) withResources++;
        else {
          issues.push(
            issue("advisory", "NO_ASSIGNMENTS", `Activity ${code} has no resource assignments`, {
              entityType: "activity",
              entityId: a.id,
              entityLabel: code,
            })
          );
        }

        const hasPred = a.relationships.predecessors.length > 0;
        const hasSucc = a.relationships.successors.length > 0;
        if (hasPred || hasSucc) withRelationships++;
        else if (totalActivities > 1) {
          issues.push(
            issue("warning", "ISOLATED_ACTIVITY", `Activity ${code} has no predecessors or successors`, {
              entityType: "activity",
              entityId: a.id,
              entityLabel: code,
              navigateHref: "/app/activities",
            })
          );
        }
      }
    }
  }

  if (emptyDeliverableCount > 0) {
    const title =
      emptyDeliverableCount === 1 ? "1 deliverable is empty" : `${emptyDeliverableCount} deliverables are empty`;
    issues.push(
      issue("warning", "EMPTY_DELIVERABLE", title, {
        entityType: "project",
        entityLabel: "No default or custom activities assigned",
        navigateHref: "/app/deliverables",
      })
    );
  }
  if (pendingMaterializationCount > 0) {
    const title =
      pendingMaterializationCount === 1
        ? "1 deliverable needs default activities applied"
        : `${pendingMaterializationCount} deliverables need default activities applied`;
    issues.push(
      issue("info", "PENDING_MATERIALIZATION", title, {
        entityType: "project",
        entityLabel: "Use Fragnets → Apply default activities",
        navigateHref: "/app/fragnets",
      })
    );
  }

  let duplicateDeliverableInstances = 0;
  for (const [, ids] of deliverableNames) {
    if (ids.length > 1) duplicateDeliverableInstances += ids.length;
  }
  if (duplicateDeliverableInstances > 0) {
    issues.push(
      issue(
        "advisory",
        "DUPLICATE_DELIVERABLE_NAME",
        `${duplicateDeliverableInstances} deliverables use names that appear more than once`,
        {
          entityType: "deliverable",
          navigateHref: "/app/deliverables",
        }
      )
    );
  }

  for (const f of data.fragnets) {
    const codesInFragnet = new Map<string, { count: number; ids: string[] }>();
    for (const d of f.deliverables) {
      for (const a of d.activities) {
        const code = a.activityCode.trim();
        if (!code) continue;
        const prev = codesInFragnet.get(code) ?? { count: 0, ids: [] };
        prev.count += 1;
        prev.ids.push(a.id);
        codesInFragnet.set(code, prev);
      }
    }
    for (const [code, { count, ids }] of codesInFragnet) {
      if (count > 1) {
        issues.push(
          issue(
            "critical",
            "DUPLICATE_TASK_CODE",
            `Activity code "${code}" is duplicated ${count} times in fragnet "${f.name}" — each instance needs a unique code (e.g. DEL-A1000)`,
            {
              entityType: "activity",
              entityId: ids[0],
              entityLabel: code,
              navigateHref: "/app/schedule",
            }
          )
        );
      }
    }
  }

  const edgeKeys = new Set<string>();
  for (const f of data.fragnets) {
    for (const d of f.deliverables) {
      for (const a of d.activities) {
        for (const p of a.relationships.predecessors) {
          if (p.deliverableName) {
            const ek = `del:${p.deliverableName}\x1d${a.activityCode}\x1d${p.relationshipType}`;
            if (edgeKeys.has(ek)) {
              issues.push(
                issue(
                  "critical",
                  "DUPLICATE_RELATIONSHIP",
                  `Duplicate deliverable link ${p.deliverableName} → ${a.activityCode} (${p.relationshipType})`,
                  { entityType: "relationship", entityLabel: ek }
                )
              );
            }
            edgeKeys.add(ek);
            continue;
          }
          if (!p.activityCode || !codeToActivityId.has(p.activityCode)) {
            issues.push(
              issue("critical", "ORPHAN_PRED", `Activity ${a.activityCode}: unknown predecessor ${p.activityCode || "?"}`, {
                entityType: "relationship",
                entityId: a.id,
                entityLabel: `${p.activityCode} → ${a.activityCode}`,
                navigateHref: "/app/activities",
              })
            );
          }
          const ek = `${p.activityCode}\x1d${a.activityCode}\x1d${p.relationshipType}`;
          if (edgeKeys.has(ek)) {
            issues.push(
              issue("critical", "DUPLICATE_RELATIONSHIP", `Duplicate link ${p.activityCode} → ${a.activityCode} (${p.relationshipType})`, {
                entityType: "relationship",
                entityLabel: ek,
              })
            );
          }
          edgeKeys.add(ek);
          if (p.activityCode === a.activityCode) {
            issues.push(
              issue("critical", "SELF_LINK", `Activity ${a.activityCode} cannot link to itself`, {
                entityType: "activity",
                entityId: a.id,
              })
            );
          }
        }
      }
    }
  }

  if (rateCard.length === 0) {
    const anyAssigned = data.fragnets.some((f) =>
      f.deliverables.some((d) => d.activities.some((a) => a.assignedResources.length > 0))
    );
    if (anyAssigned) {
      issues.push(
        issue("critical", "NO_RATE_CARD", "Resources are assigned but no rate card is loaded", {
          navigateHref: "/app/rate-card",
        })
      );
    } else {
      issues.push(
        issue("warning", "NO_RATE_CARD_EMPTY", "No rate card uploaded — costs cannot be calculated", {
          navigateHref: "/app/rate-card",
        })
      );
    }
  }

  if (totalActivities > 5 && withResources / totalActivities < 0.15) {
    issues.push(
      issue("advisory", "SPARSE_SCHEDULE", "Few activities have resource assignments — schedule is sparse", {
        entityType: "project",
      })
    );
  }

  if (totalActivities > 3 && withRelationships / totalActivities < 0.2) {
    issues.push(
      issue(
        "info",
        "SCHEDULE_DENSITY",
        "Most activities lack network links — consider adding predecessors for sequencing",
        { entityType: "project" }
      )
    );
  }

  return issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

/** Detect cycles in fragnet relationship graph (activity ids). */
export function detectRelationshipCycles(
  activities: Activity[],
  relationships: Relationship[]
): string[] {
  const ids = new Set(activities.map((a) => a.id));
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const r of relationships) {
    if (!ids.has(r.predecessorActivityId) || !ids.has(r.successorActivityId)) continue;
    if (r.predecessorActivityId === r.successorActivityId) continue;
    adj.get(r.predecessorActivityId)!.push(r.successorActivityId);
  }

  const cycles: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(n: string, stack: string[]): void {
    if (visiting.has(n)) {
      const idx = stack.indexOf(n);
      cycles.push(stack.slice(idx).concat(n).join(" → "));
      return;
    }
    if (visited.has(n)) return;
    visiting.add(n);
    for (const next of adj.get(n) ?? []) dfs(next, [...stack, n]);
    visiting.delete(n);
    visited.add(n);
  }

  for (const id of ids) dfs(id, []);
  return [...new Set(cycles)];
}

export function validateFragnetRelationships(
  activities: Activity[],
  relationships: Relationship[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [...validateFragnetRelationshipHealth(activities, relationships)];
  const idSet = new Set(activities.map((a) => a.id));
  const codeById = new Map(activities.map((a) => [a.id, a.activityCode]));

  for (const r of relationships) {
    if (!idSet.has(r.predecessorActivityId) || !idSet.has(r.successorActivityId)) {
      issues.push(
        issue("critical", "ORPHAN_RELATIONSHIP", "Relationship references missing activity", {
          entityType: "relationship",
          entityId: r.id,
        })
      );
    }
    if (r.predecessorActivityId === r.successorActivityId) {
      issues.push(
        issue("critical", "SELF_LINK", `Self-link on ${codeById.get(r.predecessorActivityId) ?? r.predecessorActivityId}`, {
          entityType: "relationship",
          entityId: r.id,
        })
      );
    }
  }

  return issues;
}
