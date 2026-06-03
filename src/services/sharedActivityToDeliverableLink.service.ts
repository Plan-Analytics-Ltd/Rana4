import type { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

const DEFAULT_SHARED_TO_DELIVERABLE_TYPE: RelationshipType = "FS";

/**
 * For each deliverable linked to a shared activity, ensure activity → deliverable FS.
 * Removes stale FS rows when deliverables are unlinked.
 */
export async function syncSharedActivityToLinkedDeliverableFsLinks(
  activityId: string,
  companyId: string
): Promise<void> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, companyId },
    select: {
      id: true,
      fragnetId: true,
      projectId: true,
      isSharedAcrossDeliverables: true,
    },
  });
  if (!activity?.isSharedAcrossDeliverables || !activity.fragnetId) return;

  const linked = await prisma.activityDeliverable.findMany({
    where: { activityId, companyId },
    select: { deliverableId: true },
  });
  const linkedIds = linked.map((l) => l.deliverableId);

  await prisma.activityToDeliverableRelationship.deleteMany({
    where: {
      companyId,
      predecessorActivityId: activityId,
      relationshipType: DEFAULT_SHARED_TO_DELIVERABLE_TYPE,
      ...(linkedIds.length > 0 ? { successorDeliverableId: { notIn: linkedIds } } : {}),
    },
  });

  for (const deliverableId of linkedIds) {
    const existing = await prisma.activityToDeliverableRelationship.findFirst({
      where: {
        fragnetId: activity.fragnetId,
        predecessorActivityId: activityId,
        successorDeliverableId: deliverableId,
        relationshipType: DEFAULT_SHARED_TO_DELIVERABLE_TYPE,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.activityToDeliverableRelationship.create({
      data: {
        fragnetId: activity.fragnetId,
        predecessorActivityId: activityId,
        successorDeliverableId: deliverableId,
        relationshipType: DEFAULT_SHARED_TO_DELIVERABLE_TYPE,
        lag: 0,
        projectId: activity.projectId,
        companyId,
      },
    });
  }
}

/** Reconcile activity → deliverable FS for every shared activity on a fragnet. */
export async function syncFragnetSharedActivityToLinkedDeliverableFsLinks(
  fragnetId: string,
  companyId: string
): Promise<void> {
  const shared = await prisma.activity.findMany({
    where: { fragnetId, companyId, isSharedAcrossDeliverables: true },
    select: { id: true },
  });
  for (const a of shared) {
    await syncSharedActivityToLinkedDeliverableFsLinks(a.id, companyId);
  }
}
