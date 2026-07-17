import type { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { syncDeliverableToFirstActivityFsLink } from "./deliverableFirstActivityLink.service.js";

const DEFAULT_TYPE: RelationshipType = "FS";
const LINKAGE_CHUNK_SIZE = 25;

function relationshipPairKey(predecessorActivityId: string, successorActivityId: string): string {
  return `${predecessorActivityId}\x1d${successorActivityId}`;
}

type DeliverableContext = {
  id: string;
  fragnetId: string | null;
  projectId: string;
};

type ProjectLinkageCache = {
  deliverablesById: Map<string, DeliverableContext>;
  activitiesByDeliverableId: Map<string, Array<{ id: string; fragnetId: string | null }>>;
  existingActivityPairs: Set<string>;
  pendingActivityPairs: Set<string>;
};

async function buildProjectLinkageCache(
  projectId: string,
  companyId: string
): Promise<ProjectLinkageCache> {
  const [deliverables, activities, relationships] = await Promise.all([
    prisma.deliverable.findMany({
      where: { projectId, companyId },
      select: { id: true, fragnetId: true, projectId: true },
    }),
    prisma.activity.findMany({
      where: {
        projectId,
        companyId,
        isSharedAcrossDeliverables: false,
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, fragnetId: true, deliverableId: true },
    }),
    prisma.relationship.findMany({
      where: { projectId, companyId },
      select: { predecessorActivityId: true, successorActivityId: true },
    }),
  ]);

  const deliverablesById = new Map(deliverables.map((d) => [d.id, d]));
  const activitiesByDeliverableId = new Map<string, Array<{ id: string; fragnetId: string | null }>>();
  for (const activity of activities) {
    if (!activity.deliverableId) continue;
    const bucket = activitiesByDeliverableId.get(activity.deliverableId) ?? [];
    bucket.push({ id: activity.id, fragnetId: activity.fragnetId });
    activitiesByDeliverableId.set(activity.deliverableId, bucket);
  }

  const existingActivityPairs = new Set(
    relationships.map((r) => relationshipPairKey(r.predecessorActivityId, r.successorActivityId))
  );

  return {
    deliverablesById,
    activitiesByDeliverableId,
    existingActivityPairs,
    pendingActivityPairs: new Set(),
  };
}

async function loadDeliverableContext(
  deliverableId: string,
  companyId: string,
  cache?: ProjectLinkageCache
) {
  const cached = cache?.deliverablesById.get(deliverableId);
  if (cached && cache) {
    if (cached.fragnetId) return cached;
    const fromActivity = cache.activitiesByDeliverableId.get(deliverableId)?.[0];
    if (!fromActivity?.fragnetId) return cached;
    await prisma.deliverable.update({
      where: { id: deliverableId },
      data: { fragnetId: fromActivity.fragnetId },
    });
    const updated = { ...cached, fragnetId: fromActivity.fragnetId };
    cache.deliverablesById.set(deliverableId, updated);
    return updated;
  }

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

async function listNonSharedDeliverableActivities(
  deliverableId: string,
  companyId: string,
  cache?: ProjectLinkageCache
) {
  if (cache) {
    return cache.activitiesByDeliverableId.get(deliverableId) ?? [];
  }
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
  cache?: ProjectLinkageCache;
}): Promise<boolean> {
  if (args.predecessorActivityId === args.successorActivityId) return false;

  const pairKey = relationshipPairKey(args.predecessorActivityId, args.successorActivityId);
  if (args.cache) {
    if (args.cache.existingActivityPairs.has(pairKey) || args.cache.pendingActivityPairs.has(pairKey)) {
      return false;
    }
    args.cache.pendingActivityPairs.add(pairKey);
    return true;
  }

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

async function flushPendingActivityLinks(
  projectId: string,
  companyId: string,
  cache: ProjectLinkageCache
): Promise<void> {
  const pending = [...cache.pendingActivityPairs];
  if (pending.length === 0) return;

  const activityFragnetById = new Map<string, string>();
  for (const activities of cache.activitiesByDeliverableId.values()) {
    for (const activity of activities) {
      if (activity.fragnetId) activityFragnetById.set(activity.id, activity.fragnetId);
    }
  }

  const rows = pending
    .map((pairKey) => {
      const [predecessorActivityId, successorActivityId] = pairKey.split("\x1d");
      if (!predecessorActivityId || !successorActivityId) return null;
      const fragnetId = activityFragnetById.get(predecessorActivityId);
      if (!fragnetId) return null;
      return {
        fragnetId,
        predecessorActivityId,
        successorActivityId,
        relationshipType: DEFAULT_TYPE,
        lag: 0,
        projectId,
        companyId,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row != null);

  for (let i = 0; i < rows.length; i += LINKAGE_CHUNK_SIZE) {
    const chunk = rows.slice(i, i + LINKAGE_CHUNK_SIZE);
    await prisma.relationship.createMany({ data: chunk, skipDuplicates: true });
    for (const row of chunk) {
      cache.existingActivityPairs.add(
        relationshipPairKey(row.predecessorActivityId, row.successorActivityId)
      );
    }
  }
  cache.pendingActivityPairs.clear();
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
  cache?: ProjectLinkageCache;
}): Promise<{ linksCreated: number }> {
  const activities = await listNonSharedDeliverableActivities(
    args.deliverableId,
    args.companyId,
    args.cache
  );
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
      cache: args.cache,
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
  companyId: string,
  cache?: ProjectLinkageCache
): Promise<{ predecessorActivityId: string | null }> {
  const deliverable = await loadDeliverableContext(deliverableId, companyId, cache);
  if (!deliverable?.fragnetId) return { predecessorActivityId: null };

  const activities = await listNonSharedDeliverableActivities(deliverableId, companyId, cache);
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
  const cache = await buildProjectLinkageCache(projectId, companyId);
  const deliverables = [...cache.deliverablesById.values()]
    .filter((d) => d.fragnetId != null)
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const d of deliverables) {
    await syncDeliverableActivityLinkage(d.id, companyId, cache);
  }
  await flushPendingActivityLinks(projectId, companyId, cache);
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
  companyId: string,
  cache?: ProjectLinkageCache
): Promise<void> {
  const deliverable = await loadDeliverableContext(deliverableId, companyId, cache);
  if (!deliverable?.fragnetId) return;

  await reconcileDeliverableActivityChain({
    companyId,
    projectId: deliverable.projectId,
    fragnetId: deliverable.fragnetId,
    deliverableId,
    cache,
  });
  await syncDeliverableToFirstActivityFsLink(deliverableId, companyId);
  await syncLastActivityToDeliverableFsLink(deliverableId, companyId, cache);
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