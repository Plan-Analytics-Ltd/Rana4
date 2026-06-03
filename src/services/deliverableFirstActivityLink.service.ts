import type { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

const DEFAULT_DELIVERABLE_TO_ACTIVITY_TYPE: RelationshipType = "FS";

/**
 * The first activity created on a deliverable (by createdAt) receives deliverable → activity FS.
 * Re-sync after create/delete so Schedule and export match MVP workflow rules.
 */
export async function syncDeliverableToFirstActivityFsLink(
  deliverableId: string,
  companyId: string
): Promise<{ successorActivityId: string | null }> {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, companyId },
    select: { id: true, fragnetId: true, projectId: true },
  });
  if (!deliverable?.fragnetId) {
    return { successorActivityId: null };
  }

  const first = await prisma.activity.findFirst({
    where: {
      companyId,
      deliverableId,
      isSharedAcrossDeliverables: false,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  await prisma.deliverableActivityRelationship.deleteMany({
    where: {
      companyId,
      predecessorDeliverableId: deliverableId,
      relationshipType: DEFAULT_DELIVERABLE_TO_ACTIVITY_TYPE,
    },
  });

  if (!first) {
    return { successorActivityId: null };
  }

  const existing = await prisma.deliverableActivityRelationship.findFirst({
    where: {
      fragnetId: deliverable.fragnetId,
      predecessorDeliverableId: deliverableId,
      successorActivityId: first.id,
      relationshipType: DEFAULT_DELIVERABLE_TO_ACTIVITY_TYPE,
    },
  });
  if (!existing) {
    await prisma.deliverableActivityRelationship.create({
      data: {
        fragnetId: deliverable.fragnetId,
        predecessorDeliverableId: deliverableId,
        successorActivityId: first.id,
        relationshipType: DEFAULT_DELIVERABLE_TO_ACTIVITY_TYPE,
        lag: 0,
        projectId: deliverable.projectId,
        companyId,
      },
    });
  }

  return { successorActivityId: first.id };
}

/** Reconcile deliverable → first-activity FS for every deliverable on a fragnet. */
export async function syncFragnetDeliverableToFirstActivityFsLinks(
  fragnetId: string,
  companyId: string
): Promise<void> {
  const deliverables = await prisma.deliverable.findMany({
    where: { fragnetId, companyId },
    select: { id: true },
  });
  for (const d of deliverables) {
    await syncDeliverableToFirstActivityFsLink(d.id, companyId);
  }
}
