export type DeliverableGraphEdge = {
  predecessor: string;
  successor: string;
  relationshipCount: number;
  averageLag: number;
};

export type DeliverableRelationshipGraph = {
  nodes: string[];
  edges: DeliverableGraphEdge[];
};

/**
 * Build deliverable-level dependency chains from activity relationship snapshots.
 * Aggregates activity predecessor/successor pairs into deliverable pairs.
 */
export function buildDeliverableRelationshipGraph(args: {
  activityDeliverableMap: Map<string, string>;
  relationships: Array<{
    predecessorActivityCode: string;
    successorActivityCode: string;
    lag: number;
  }>;
}): DeliverableRelationshipGraph {
  const edgeMap = new Map<string, { count: number; lagSum: number }>();
  const nodes = new Set<string>();

  for (const rel of args.relationships) {
    const predDel = args.activityDeliverableMap.get(rel.predecessorActivityCode.trim().toUpperCase());
    const succDel = args.activityDeliverableMap.get(rel.successorActivityCode.trim().toUpperCase());
    if (!predDel || !succDel || predDel === succDel) continue;
    nodes.add(predDel);
    nodes.add(succDel);
    const key = `${predDel}\x1d${succDel}`;
    const bucket = edgeMap.get(key) ?? { count: 0, lagSum: 0 };
    bucket.count += 1;
    bucket.lagSum += rel.lag;
    edgeMap.set(key, bucket);
  }

  const edges: DeliverableGraphEdge[] = [...edgeMap.entries()].map(([key, v]) => {
    const [predecessor, successor] = key.split("\x1d");
    return {
      predecessor: predecessor!,
      successor: successor!,
      relationshipCount: v.count,
      averageLag: Math.round(v.lagSum / v.count),
    };
  });

  return {
    nodes: [...nodes],
    edges: edges.sort((a, b) => b.relationshipCount - a.relationshipCount),
  };
}

/** Describe a historical co-movement pattern between linked deliverables (no prediction). */
export function describeHistoricalCoMovement(args: {
  predecessor: string;
  successor: string;
  predecessorGrowthPercent: number | null;
  successorGrowthPercent: number | null;
}): string | null {
  if (args.predecessorGrowthPercent == null || args.successorGrowthPercent == null) return null;
  if (args.predecessorGrowthPercent >= 15 && args.successorGrowthPercent >= 10) {
    return `When ${args.predecessor} expanded in historical programmes, ${args.successor} also tended to grow in duration.`;
  }
  return null;
}
