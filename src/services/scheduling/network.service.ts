import type { ScheduleActivityInput, ScheduleRelationshipInput } from "./types.js";

export type ActivityGraph = {
  activityIds: Set<string>;
  /** predecessor -> successors */
  adj: Map<string, string[]>;
  /** successor -> predecessors */
  rev: Map<string, string[]>;
  relationships: ScheduleRelationshipInput[];
  byId: Map<string, ScheduleActivityInput>;
};

export function buildActivityGraph(
  activities: ScheduleActivityInput[],
  relationships: ScheduleRelationshipInput[]
): ActivityGraph {
  const activityIds = new Set(activities.map((a) => a.id));
  const adj = new Map<string, string[]>();
  const rev = new Map<string, string[]>();
  const byId = new Map(activities.map((a) => [a.id, a]));

  for (const id of activityIds) {
    adj.set(id, []);
    rev.set(id, []);
  }

  const rels: ScheduleRelationshipInput[] = [];
  for (const r of relationships) {
    if (!activityIds.has(r.predecessorActivityId) || !activityIds.has(r.successorActivityId)) continue;
    if (r.predecessorActivityId === r.successorActivityId) continue;
    adj.get(r.predecessorActivityId)!.push(r.successorActivityId);
    rev.get(r.successorActivityId)!.push(r.predecessorActivityId);
    rels.push(r);
  }

  return { activityIds, adj, rev, relationships: rels, byId };
}

export function detectCycles(graph: ActivityGraph): string[][] {
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(n: string, stack: string[]): void {
    if (visiting.has(n)) {
      const idx = stack.indexOf(n);
      if (idx >= 0) cycles.push([...stack.slice(idx), n]);
      return;
    }
    if (visited.has(n)) return;
    visiting.add(n);
    for (const next of graph.adj.get(n) ?? []) dfs(next, [...stack, n]);
    visiting.delete(n);
    visited.add(n);
  }

  for (const id of graph.activityIds) dfs(id, []);
  return dedupeCycles(cycles);
}

function dedupeCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const c of cycles) {
    const key = [...c].sort().join(",");
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** Kahn topological sort; returns empty if cycle exists. */
export function topologicalSort(graph: ActivityGraph): string[] {
  const inDegree = new Map<string, number>();
  for (const id of graph.activityIds) inDegree.set(id, 0);
  for (const r of graph.relationships) {
    inDegree.set(r.successorActivityId, (inDegree.get(r.successorActivityId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }
  queue.sort();

  const order: string[] = [];
  while (queue.length) {
    const n = queue.shift()!;
    order.push(n);
    for (const next of graph.adj.get(n) ?? []) {
      const d = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, d);
      if (d === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  return order.length === graph.activityIds.size ? order : [];
}

export function findDisconnectedComponents(graph: ActivityGraph): string[][] {
  const undirected = new Map<string, Set<string>>();
  for (const id of graph.activityIds) undirected.set(id, new Set());
  for (const r of graph.relationships) {
    undirected.get(r.predecessorActivityId)!.add(r.successorActivityId);
    undirected.get(r.successorActivityId)!.add(r.predecessorActivityId);
  }

  const visited = new Set<string>();
  const components: string[][] = [];

  for (const start of graph.activityIds) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    while (stack.length) {
      const n = stack.pop()!;
      if (visited.has(n)) continue;
      visited.add(n);
      comp.push(n);
      for (const nb of undirected.get(n) ?? []) {
        if (!visited.has(nb)) stack.push(nb);
      }
    }
    comp.sort();
    components.push(comp);
  }

  return components.sort((a, b) => b.length - a.length);
}

export function roots(graph: ActivityGraph): string[] {
  const r: string[] = [];
  for (const id of graph.activityIds) {
    if ((graph.rev.get(id)?.length ?? 0) === 0) r.push(id);
  }
  return r.sort();
}

export function terminals(graph: ActivityGraph): string[] {
  const t: string[] = [];
  for (const id of graph.activityIds) {
    if ((graph.adj.get(id)?.length ?? 0) === 0) t.push(id);
  }
  return t.sort();
}
