import type { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { compareActivityCodes, parseActivityCode } from "./activityCodeSequence.service.js";

type ActivityRow = { id: string; createdAt: Date; templateActivityId: string | null; activityCode: string };

function sortActivitiesByCode(activities: ActivityRow[]): ActivityRow[] {
  return [...activities].sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode));
}

/** First workflow step (no in-deliverable predecessor) — lowest activity ID. */
export function findEntryActivityId(
  activityIds: Set<string>,
  relationships: { predecessorActivityId: string; successorActivityId: string }[],
  codeById: Map<string, string>
): string | null {
  const blockRels = relationships.filter(
    (r) => activityIds.has(r.predecessorActivityId) && activityIds.has(r.successorActivityId)
  );
  const successorIds = new Set(blockRels.map((r) => r.successorActivityId));
  const entries = [...activityIds].filter((id) => !successorIds.has(id));
  if (entries.length === 0) return null;
  return entries.sort((a, b) =>
    compareActivityCodes(codeById.get(a) ?? a, codeById.get(b) ?? b)
  )[0] ?? null;
}

/** Last workflow step (no in-deliverable successor) — highest activity ID. */
export function findExitActivityId(
  activityIds: Set<string>,
  relationships: { predecessorActivityId: string; successorActivityId: string }[],
  codeById: Map<string, string>
): string | null {
  const blockRels = relationships.filter(
    (r) => activityIds.has(r.predecessorActivityId) && activityIds.has(r.successorActivityId)
  );
  const predecessorIds = new Set(blockRels.map((r) => r.predecessorActivityId));
  const exits = [...activityIds].filter((id) => !predecessorIds.has(id));
  if (exits.length === 0) return null;
  return exits.sort((a, b) =>
    compareActivityCodes(codeById.get(a) ?? a, codeById.get(b) ?? b)
  ).reverse()[0] ?? null;
}

/**
 * When deliverable A links to deliverable B, connect exit activity of A → entry activity of B.
 */
export async function propagateDeliverableRelationshipsForFragnet(
  fragnetId: string,
  companyId: string
): Promise<{ created: number; removed: number }> {
  const fragnet = await prisma.fragnet.findFirst({
    where: { id: fragnetId, companyId },
    select: { projectId: true },
  });
  if (!fragnet) return { created: 0, removed: 0 };
  return propagateDeliverableRelationshipsForProject(fragnet.projectId, companyId);
}

export async function propagateDeliverableRelationshipsForProject(
  projectId: string,
  companyId: string
): Promise<{ created: number; removed: number }> {
  const deliverableRelationships = await prisma.deliverableRelationship.findMany({
    where: { projectId, companyId },
  });
  if (deliverableRelationships.length === 0) return { created: 0, removed: 0 };

  const activities = await prisma.activity.findMany({
    where: { projectId, companyId },
    select: {
      id: true,
      fragnetId: true,
      createdAt: true,
      templateActivityId: true,
      activityCode: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const codeById = new Map(activities.map((a) => [a.id, a.activityCode]));
  const fragnetIdByActivityId = new Map(activities.map((a) => [a.id, a.fragnetId]));
  const activityById = new Map(activities.map((a) => [a.id, a]));

  const activityDeliverableLinks = await prisma.activityDeliverable.findMany({
    where: { projectId, companyId },
    select: { activityId: true, deliverableId: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  const byDeliverable = new Map<string, ActivityRow[]>();
  for (const link of activityDeliverableLinks) {
    const activity = activityById.get(link.activityId);
    if (!activity) continue;
    const list = byDeliverable.get(link.deliverableId) ?? [];
    list.push(activity);
    byDeliverable.set(link.deliverableId, list);
  }

  const relationships = await prisma.relationship.findMany({
    where: { projectId, companyId },
    select: { id: true, predecessorActivityId: true, successorActivityId: true },
  });

  const wantedPairs = new Map<
    string,
    { predActId: string; succActId: string; ownerFragnetId: string; relationshipType: RelationshipType; lag: number }
  >();

  for (const dr of deliverableRelationships) {
    const predActs = sortActivitiesByCode(byDeliverable.get(dr.predecessorDeliverableId) ?? []);
    const succActs = sortActivitiesByCode(byDeliverable.get(dr.successorDeliverableId) ?? []);
    if (predActs.length === 0 || succActs.length === 0) continue;

    const predIds = new Set(predActs.map((a) => a.id));
    const succIds = new Set(succActs.map((a) => a.id));
    const exitId = findExitActivityId(predIds, relationships, codeById);
    const entryId = findEntryActivityId(succIds, relationships, codeById);
    const ownerFragnetId = exitId ? fragnetIdByActivityId.get(exitId) : undefined;
    if (!exitId || !entryId || exitId === entryId || !ownerFragnetId) continue;

    wantedPairs.set(`${exitId}|${entryId}|${dr.relationshipType}`, {
      predActId: exitId,
      succActId: entryId,
      ownerFragnetId,
      relationshipType: dr.relationshipType,
      lag: dr.lag,
    });
  }

  let created = 0;
  let removed = 0;
  for (const w of wantedPairs.values()) {
    const dup = await prisma.relationship.findFirst({
      where: {
        companyId,
        projectId,
        predecessorActivityId: w.predActId,
        successorActivityId: w.succActId,
      },
    });
    if (dup) {
      if (
        dup.relationshipType !== w.relationshipType ||
        dup.lag !== w.lag ||
        dup.fragnetId !== w.ownerFragnetId
      ) {
        await prisma.relationship.update({
          where: { id: dup.id },
          data: {
            fragnetId: w.ownerFragnetId,
            relationshipType: w.relationshipType,
            lag: w.lag,
          },
        });
      }
      continue;
    }
    await prisma.relationship.create({
      data: {
        fragnetId: w.ownerFragnetId,
        predecessorActivityId: w.predActId,
        successorActivityId: w.succActId,
        relationshipType: w.relationshipType,
        lag: w.lag,
        projectId,
        companyId,
      },
    });
    created++;
  }
  return { created, removed };
}
