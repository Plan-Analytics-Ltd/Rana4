import type {
  ActivityToDeliverableRelationship,
  DeliverableActivityRelationship,
  DeliverableRelationship,
  ScheduleNetworkRelationship,
} from "@/lib/api";
import { deliverableScheduleNodeId } from "@/lib/schedule-node-ids";

/** Activity + deliverable links for schedule Gantt (deliverable rows use `del:` node ids). */
export function buildScheduleViewRelationships(
  activityRelationships: ScheduleNetworkRelationship[],
  deliverableRelationships: DeliverableRelationship[],
  deliverableActivityRelationships: DeliverableActivityRelationship[] = [],
  activityToDeliverableRelationships: ActivityToDeliverableRelationship[] = []
): ScheduleNetworkRelationship[] {
  const deliverableLinks: ScheduleNetworkRelationship[] = deliverableRelationships.map((r) => ({
    id: r.id,
    predecessorActivityId: deliverableScheduleNodeId(r.predecessorDeliverableId),
    successorActivityId: deliverableScheduleNodeId(r.successorDeliverableId),
    relationshipType: r.relationshipType,
    lag: r.lag,
  }));
  const deliverableActivityLinks: ScheduleNetworkRelationship[] =
    deliverableActivityRelationships.map((r) => ({
      id: r.id,
      predecessorActivityId: deliverableScheduleNodeId(r.predecessorDeliverableId),
      successorActivityId: r.successorActivityId,
      relationshipType: r.relationshipType,
      lag: r.lag,
    }));
  const activityToDeliverableLinks: ScheduleNetworkRelationship[] =
    activityToDeliverableRelationships.map((r) => ({
      id: r.id,
      predecessorActivityId: r.predecessorActivityId,
      successorActivityId: deliverableScheduleNodeId(r.successorDeliverableId),
      relationshipType: r.relationshipType,
      lag: r.lag,
    }));
  return [
    ...activityRelationships,
    ...deliverableLinks,
    ...deliverableActivityLinks,
    ...activityToDeliverableLinks,
  ];
}
