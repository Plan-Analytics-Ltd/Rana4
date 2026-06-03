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

export async function listDeliverableIdsForFragnetLinkage(
  fragnetId: string,
  companyId: string
): Promise<string[]> {
  const [fromDeliverables, fromActivities] = await Promise.all([
    prisma.deliverable.findMany({
      where: { fragnetId, companyId },
      select: { id: true },
    }),
    prisma.activity.findMany({
      where: {
        fragnetId,
        companyId,
        isSharedAcrossDeliverables: false,
      },
      distinct: ["deliverableId"],
      select: { deliverableId: true },
    }),
  ]);
  const ids = new Set<string>();
  for (const d of fromDeliverables) ids.add(d.id);
  for (const a of fromActivities) {
    if (a.deliverableId) ids.add(a.deliverableId);
  }
  return [...ids];
}

/** Reconcile full deliverable ↔ activity linkage for every deliverable on a fragnet. */
export async function syncFragnetDeliverableToFirstActivityFsLinks(
  fragnetId: string,
  companyId: string
): Promise<void> {
  const { syncDeliverableActivityLinkage } = await import("./deliverableActivityChain.service.js");
  const deliverableIds = await listDeliverableIdsForFragnetLinkage(fragnetId, companyId);
  for (const deliverableId of deliverableIds) {
    await syncDeliverableActivityLinkage(deliverableId, companyId);
  }
}

/** Repair linkage for every fragnet on a standard (all RIBA stages in that standard). */
export async function syncStandardFragnetActivityLinkages(
  standardId: string,
  companyId: string
): Promise<void> {
  const fragnets = await prisma.fragnet.findMany({
    where: { standardId, companyId },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const fragnet of fragnets) {
    await syncFragnetDeliverableToFirstActivityFsLinks(fragnet.id, companyId);
  }
}