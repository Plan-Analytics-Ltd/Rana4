import type { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { syncDeliverableToFirstActivityFsLink } from "./deliverableFirstActivityLink.service.js";

const DEFAULT_TYPE: RelationshipType = "FS";

async function loadDeliverableContext(deliverableId: string, companyId: string) {
  const deliverable = await prisma.deliverable.findFirst({
    where: { id: deliverableId, companyId },
    select: { id: true, fragnetId: true, projectId: true },
  });
  if (!deliverable) return null;
  if (deliverable.fragnetId) return deliverable;

  const fromActivity = await prisma.activity.findFirst({
    where: {
      companyId,
      deliverableId,
      isSharedAcrossDeliverables: false,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { fragnetId: true },
  });
  if (!fromActivity?.fragnetId) return deliverable;

  await prisma.deliverable.update({
    where: { id: deliverableId },
    data: { fragnetId: fromActivity.fragnetId },
  });
  return { ...deliverable, fragnetId: fromActivity.fragnetId };
}

async function listNonSharedDeliverableActivities(deliverableId: string, companyId: string) {
  return prisma.activity.findMany({
    where: {
      companyId,
      deliverableId,
      isSharedAcrossDeliverables: false,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, fragnetId: true },
  });
}

async function ensureActivityFsLink(args: {
  companyId: string;
  projectId: string;
  fragnetId: string;
  predecessorActivityId: string;
  successorActivityId: string;
}): Promise<boolean> {
  if (args.predecessorActivityId === args.successorActivityId) return false;

  const existing = await prisma.relationship.findFirst({
    where: {
      companyId: args.companyId,
      projectId: args.projectId,
      predecessorActivityId: args.predecessorActivityId,
      successorActivityId: args.successorActivityId,
    },
    select: { id: true },
  });
  if (existing) return false;

  await prisma.relationship.create({
    data: {
      fragnetId: args.fragnetId,
      predecessorActivityId: args.predecessorActivityId,
      successorActivityId: args.successorActivityId,
      relationshipType: DEFAULT_TYPE,
      lag: 0,
      projectId: args.projectId,
      companyId: args.companyId,
    },
  });
  return true;
}

/**
 * Ensure every consecutive pair of non-shared activities on a deliverable is linked FS
 * (by createdAt order). Backfills gaps so activity 15+ are not orphaned.
 */
export async function reconcileDeliverableActivityChain(args: {
  companyId: string;
  projectId: string;
  fragnetId: string;
  deliverableId: string;
}): Promise<{ linksCreated: number }> {
  const activities = await listNonSharedDeliverableActivities(args.deliverableId, args.companyId);
  let linksCreated = 0;

  for (let i = 1; i < activities.length; i++) {
    const predecessor = activities[i - 1]!;
    const successor = activities[i]!;
    if (predecessor.fragnetId !== args.fragnetId || successor.fragnetId !== args.fragnetId) continue;

    const created = await ensureActivityFsLink({
      companyId: args.companyId,
      projectId: args.projectId,
      fragnetId: args.fragnetId,
      predecessorActivityId: predecessor.id,
      successorActivityId: successor.id,
    });
    if (created) linksCreated++;
  }

  return { linksCreated };
}

/**
 * Activity → deliverable FS for the confirmed end of the chain (not the newest row).
 * The chronologically last activity stays unlinked until a newer activity is added; then the
 * previous last becomes the closing predecessor to the deliverable summary.
 */
export async function syncLastActivityToDeliverableFsLink(
  deliverableId: string,
  companyId: string
): Promise<{ predecessorActivityId: string | null }> {
  const deliverable = await loadDeliverableContext(deliverableId, companyId);
  if (!deliverable?.fragnetId) return { predecessorActivityId: null };

  const activities = await listNonSharedDeliverableActivities(deliverableId, companyId);
  const closing =
    activities.length >= 2 ? activities[activities.length - 2]! : null;

  await prisma.activityToDeliverableRelationship.deleteMany({
    where: {
      companyId,
      successorDeliverableId: deliverableId,
      relationshipType: DEFAULT_TYPE,
      ...(closing ? { predecessorActivityId: { not: closing.id } } : {}),
    },
  });

  if (!closing) return { predecessorActivityId: null };

  const existing = await prisma.activityToDeliverableRelationship.findFirst({
    where: {
      fragnetId: deliverable.fragnetId,
      predecessorActivityId: closing.id,
      successorDeliverableId: deliverableId,
      relationshipType: DEFAULT_TYPE,
    },
    select: { id: true },
  });
  if (!existing) {
    await prisma.activityToDeliverableRelationship.create({
      data: {
        fragnetId: deliverable.fragnetId,
        predecessorActivityId: closing.id,
        successorDeliverableId: deliverableId,
        relationshipType: DEFAULT_TYPE,
        lag: 0,
        projectId: deliverable.projectId,
        companyId,
      },
    });
  }

  return { predecessorActivityId: closing.id };
}

/**
 * Full linkage for one deliverable:
 * 1) FS chain across all activities (createdAt order)
 * 2) deliverable → first activity
 * 3) penultimate activity → deliverable (newest activity stays open until superseded)
 */
/** Reconcile linkage for every deliverable on a project (e.g. before schedule recalc). */
export async function syncProjectDeliverableActivityLinkages(
  projectId: string,
  companyId: string
): Promise<void> {
  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId, fragnetId: { not: null } },
    select: { id: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  for (const d of deliverables) {
    await syncDeliverableActivityLinkage(d.id, companyId);
  }
}

/** Backfill deliverable.fragnet_id from activities so export/WBS validation can resolve stages. */
export async function repairDeliverableFragnetIdsForProject(
  projectId: string,
  companyId: string
): Promise<{ updated: number }> {
  const deliverables = await prisma.deliverable.findMany({
    where: { projectId, companyId, fragnetId: null },
    select: { id: true },
  });
  let updated = 0;
  for (const d of deliverables) {
    const fromActivity = await prisma.activity.findFirst({
      where: {
        companyId,
        deliverableId: d.id,
        isSharedAcrossDeliverables: false,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { fragnetId: true },
    });
    if (!fromActivity?.fragnetId) continue;
    await prisma.deliverable.update({
      where: { id: d.id },
      data: { fragnetId: fromActivity.fragnetId },
    });
    updated += 1;
  }
  return { updated };
}

export async function syncDeliverableActivityLinkage(
  deliverableId: string,
  companyId: string
): Promise<void> {
  const deliverable = await loadDeliverableContext(deliverableId, companyId);
  if (!deliverable?.fragnetId) return;

  await reconcileDeliverableActivityChain({
    companyId,
    projectId: deliverable.projectId,
    fragnetId: deliverable.fragnetId,
    deliverableId,
  });
  await syncDeliverableToFirstActivityFsLink(deliverableId, companyId);
  await syncLastActivityToDeliverableFsLink(deliverableId, companyId);
}

/** When a new non-shared activity is added, reconcile the full deliverable chain. */
export async function linkNewActivityToPriorInDeliverable(args: {
  companyId: string;
  projectId: string;
  fragnetId: string;
  deliverableId: string;
  newActivityId: string;
}): Promise<{ linked: boolean; predecessorActivityId?: string }> {
  await syncDeliverableActivityLinkage(args.deliverableId, args.companyId);

  const activities = await listNonSharedDeliverableActivities(args.deliverableId, args.companyId);
  const newIndex = activities.findIndex((a) => a.id === args.newActivityId);
  if (newIndex <= 0) return { linked: false };

  return { linked: true, predecessorActivityId: activities[newIndex - 1]!.id };
}