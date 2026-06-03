/** Planner / Gantt node id for a deliverable acting as a P6 summary task. */
export const DELIVERABLE_NODE_PREFIX = "del:";

export function deliverableScheduleNodeId(deliverableId: string): string {
  return `${DELIVERABLE_NODE_PREFIX}${deliverableId}`;
}

export function isDeliverableScheduleNodeId(nodeId: string): boolean {
  return nodeId.startsWith(DELIVERABLE_NODE_PREFIX);
}

export function deliverableIdFromScheduleNodeId(nodeId: string): string {
  return nodeId.slice(DELIVERABLE_NODE_PREFIX.length);
}
