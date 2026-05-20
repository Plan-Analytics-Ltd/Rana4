import type { Activity, Relationship, RelationshipType } from "@/lib/api";
import type { ValidationIssue } from "@/lib/schedule-validation";
import { detectRelationshipCycles } from "@/lib/schedule-validation";

const REL_TYPES = new Set<RelationshipType>(["FS", "SS", "FF", "SF"]);
const MAX_LAG_DAYS = 9999;

export type RelationshipGraphStats = {
  activityCount: number;
  relationshipCount: number;
  openEnds: string[];
  danglingEnds: string[];
  isolatedComponentCount: number;
  isolatedActivityIds: string[];
  duplicateEdgeKeys: string[];
  invalidLagRelationshipIds: string[];
  invalidTypeRelationshipIds: string[];
  cyclePaths: string[];
  /** 0–100 — higher is healthier */
  healthScore: number;
};

function issue(
  severity: ValidationIssue["severity"],
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

/** Build adjacency for fragnet activity graph. */
export function buildRelationshipAdjacency(
  activities: Activity[],
  relationships: Relationship[]
): {
  predCount: Map<string, number>;
  succCount: Map<string, number>;
  adj: Map<string, string[]>;
  codeById: Map<string, string>;
} {
  const ids = new Set(activities.map((a) => a.id));
  const predCount = new Map<string, number>();
  const succCount = new Map<string, number>();
  const adj = new Map<string, string[]>();
  const codeById = new Map(activities.map((a) => [a.id, a.activityCode]));

  for (const id of ids) {
    predCount.set(id, 0);
    succCount.set(id, 0);
    adj.set(id, []);
  }

  for (const r of relationships) {
    if (!ids.has(r.predecessorActivityId) || !ids.has(r.successorActivityId)) continue;
    if (r.predecessorActivityId === r.successorActivityId) continue;
    adj.get(r.predecessorActivityId)!.push(r.successorActivityId);
    predCount.set(r.successorActivityId, (predCount.get(r.successorActivityId) ?? 0) + 1);
    succCount.set(r.predecessorActivityId, (succCount.get(r.predecessorActivityId) ?? 0) + 1);
  }

  return { predCount, succCount, adj, codeById };
}

export function analyzeFragnetRelationshipGraph(
  activities: Activity[],
  relationships: Relationship[]
): RelationshipGraphStats {
  const { predCount, succCount, adj, codeById } = buildRelationshipAdjacency(activities, relationships);
  const ids = [...predCount.keys()];

  const openEnds: string[] = [];
  const danglingEnds: string[] = [];
  for (const id of ids) {
    const code = codeById.get(id) ?? id;
    const preds = predCount.get(id) ?? 0;
    const succs = succCount.get(id) ?? 0;
    if (preds === 0 && succs === 0 && ids.length > 1) danglingEnds.push(code);
    else if (preds === 0 && succs > 0) openEnds.push(code);
  }

  const duplicateEdgeKeys: string[] = [];
  const seen = new Set<string>();
  const invalidLagRelationshipIds: string[] = [];
  const invalidTypeRelationshipIds: string[] = [];

  for (const r of relationships) {
    const key = `${r.predecessorActivityId}\x1d${r.successorActivityId}\x1d${r.relationshipType}`;
    if (seen.has(key)) duplicateEdgeKeys.push(key);
    seen.add(key);
    if (!REL_TYPES.has(r.relationshipType)) invalidTypeRelationshipIds.push(r.id);
    if (!Number.isFinite(r.lag) || r.lag < 0 || r.lag > MAX_LAG_DAYS) invalidLagRelationshipIds.push(r.id);
  }

  const cyclePaths = detectRelationshipCycles(activities, relationships);

  const visited = new Set<string>();
  let isolatedComponentCount = 0;
  const isolatedActivityIds: string[] = [];

  function dfsComponent(start: string, component: string[]): void {
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      component.push(n);
      for (const next of adj.get(n) ?? []) {
        if (!visited.has(next)) stack.push(next);
      }
      for (const [from, outs] of adj) {
        if (outs.includes(n) && !visited.has(from)) stack.push(from);
      }
    }
  }

  for (const id of ids) {
    if (visited.has(id)) continue;
    const component: string[] = [];
    dfsComponent(id, component);
    if (component.length === 1 && ids.length > 1) isolatedActivityIds.push(id);
    isolatedComponentCount++;
  }

  let healthScore = 100;
  healthScore -= Math.min(30, openEnds.length * 3);
  healthScore -= Math.min(25, danglingEnds.length * 4);
  healthScore -= Math.min(40, cyclePaths.length * 15);
  healthScore -= Math.min(20, duplicateEdgeKeys.length * 8);
  healthScore -= Math.min(15, invalidLagRelationshipIds.length * 5);
  healthScore -= Math.min(10, isolatedComponentCount > 1 ? (isolatedComponentCount - 1) * 2 : 0);
  if (ids.length > 1 && relationships.length === 0) healthScore -= 20;

  return {
    activityCount: ids.length,
    relationshipCount: relationships.length,
    openEnds,
    danglingEnds,
    isolatedComponentCount,
    isolatedActivityIds,
    duplicateEdgeKeys,
    invalidLagRelationshipIds,
    invalidTypeRelationshipIds,
    cyclePaths,
    healthScore: Math.max(0, Math.min(100, Math.round(healthScore))),
  };
}

/** Planner-grade relationship diagnostics for a fragnet. */
export function validateFragnetRelationshipHealth(
  activities: Activity[],
  relationships: Relationship[]
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const stats = analyzeFragnetRelationshipGraph(activities, relationships);
  const codeById = new Map(activities.map((a) => [a.id, a.activityCode]));

  for (const code of stats.openEnds.slice(0, 50)) {
    issues.push(
      issue("warning", "OPEN_END", `Open start: ${code} has successors but no predecessors`, {
        entityType: "activity",
        entityLabel: code,
        navigateHref: "/app/activities",
      })
    );
  }

  for (const id of stats.isolatedActivityIds.slice(0, 50)) {
    const code = codeById.get(id) ?? id;
    issues.push(
      issue("warning", "DANGLING_LOGIC", `Isolated from network: ${code} has no links`, {
        entityType: "activity",
        entityId: id,
        entityLabel: code,
        navigateHref: "/app/activities",
      })
    );
  }

  if (stats.isolatedComponentCount > 1 && stats.activityCount > 2) {
    issues.push(
      issue(
        "warning",
        "ISOLATED_NETWORK",
        `${stats.isolatedComponentCount} separate logic networks on this fragnet — sequencing may be incomplete`,
        { entityType: "fragnet", navigateHref: "/app/activities" }
      )
    );
  }

  for (const key of stats.duplicateEdgeKeys.slice(0, 20)) {
    issues.push(
      issue("critical", "DUPLICATE_RELATIONSHIP", `Duplicate relationship edge (${key.split("\x1d").join(" → ")})`, {
        entityType: "relationship",
        entityLabel: key,
      })
    );
  }

  for (const rid of stats.invalidLagRelationshipIds) {
    const r = relationships.find((x) => x.id === rid);
    issues.push(
      issue("warning", "INVALID_LAG", `Relationship lag out of range (${r?.lag ?? "?"})`, {
        entityType: "relationship",
        entityId: rid,
        navigateHref: "/app/activities",
      })
    );
  }

  for (const c of stats.cyclePaths) {
    issues.push(
      issue("critical", "CYCLE", `Circular dependency: ${c}`, {
        entityType: "relationship",
        navigateHref: "/app/activities",
      })
    );
  }

  if (stats.healthScore < 50 && stats.activityCount > 2) {
    issues.push(
      issue("advisory", "RELATIONSHIP_HEALTH", `Relationship health score ${stats.healthScore}/100 on this fragnet`, {
        entityType: "fragnet",
        navigateHref: "/app/activities",
      })
    );
  }

  return issues;
}
