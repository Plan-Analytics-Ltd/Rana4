import type { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { replaceActivityCodeAssignmentsForActivity } from "./activityCodeAssignments.service.js";
import { allocateSequentialCodes, checkActivityCodeAvailability } from "./activityCodeSequence.service.js";
import { syncFragnetDeliverableToFirstActivityFsLinks } from "./deliverableFirstActivityLink.service.js";

export type ReplicateActivityInput = {
  companyId: string;
  projectId: string;
  fragnetId: string;
  primaryDeliverableId: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  assuranceNoteId: string | null;
  assignedResources: Prisma.InputJsonValue;
  primaryActivityCode: string;
  activityCodeByTypeId?: Record<string, string | null>;
};

/**
 * MVP behaviour: one independent activity row per deliverable in the fragnet (non-shared only).
 */
export async function createNonSharedActivityOnAllFragnetDeliverables(
  input: ReplicateActivityInput
): Promise<{ primaryActivityId: string; createdCount: number }> {
  const deliverables = await prisma.deliverable.findMany({
    where: { fragnetId: input.fragnetId, companyId: input.companyId, projectId: input.projectId },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });
  if (deliverables.length === 0) {
    throw Object.assign(new Error("No deliverables on this fragnet"), { status: 400 });
  }

  const codes = await allocateSequentialCodes(input.projectId, input.companyId, deliverables.length);
  let primaryActivityId = "";
  let createdCount = 0;
  let codeIdx = 0;

  for (const d of deliverables) {
    const existing = await prisma.activity.findFirst({
      where: {
        companyId: input.companyId,
        fragnetId: input.fragnetId,
        deliverableId: d.id,
        isSharedAcrossDeliverables: false,
        name: input.name,
      },
      select: { id: true },
    });
    if (existing) {
      if (d.id === input.primaryDeliverableId) primaryActivityId = existing.id;
      continue;
    }

    let activityCode = codes[codeIdx] ?? codes[0]!;
    codeIdx++;
    if (d.id === input.primaryDeliverableId) {
      const codeCheck = await checkActivityCodeAvailability({
        projectId: input.projectId,
        companyId: input.companyId,
        fragnetId: input.fragnetId,
        userCode: input.primaryActivityCode,
      });
      if (codeCheck.available && codeCheck.normalizedCode) {
        activityCode = codeCheck.normalizedCode;
      }
    }

    const row = await prisma.activity.create({
      data: {
        fragnetId: input.fragnetId,
        deliverableId: d.id,
        activityCode,
        name: input.name,
        bestDuration: input.bestDuration,
        likelyDuration: input.likelyDuration,
        assuranceNoteId: input.assuranceNoteId,
        assignedResources: input.assignedResources,
        projectId: input.projectId,
        companyId: input.companyId,
        isSharedAcrossDeliverables: false,
        isInherited: false,
        detachedFromTemplate: true,
      },
    });

    if (input.activityCodeByTypeId) {
      await replaceActivityCodeAssignmentsForActivity({
        companyId: input.companyId,
        activityId: row.id,
        byTypeId: input.activityCodeByTypeId,
      });
    }

    if (d.id === input.primaryDeliverableId) primaryActivityId = row.id;
    createdCount++;
  }

  if (!primaryActivityId) {
    const primary = deliverables.find((x) => x.id === input.primaryDeliverableId);
    if (primary) {
      const fallback = await prisma.activity.findFirst({
        where: {
          companyId: input.companyId,
          fragnetId: input.fragnetId,
          deliverableId: primary.id,
          name: input.name,
          isSharedAcrossDeliverables: false,
        },
        select: { id: true },
      });
      if (fallback) primaryActivityId = fallback.id;
    }
  }

  if (!primaryActivityId) {
    throw Object.assign(new Error("Failed to create activity on deliverables"), { status: 500 });
  }

  await syncFragnetDeliverableToFirstActivityFsLinks(input.fragnetId, input.companyId);

  return { primaryActivityId, createdCount };
}
