import type { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

async function replaceAssignmentsForOwner(params: {
  companyId: string;
  where: { activityId: string } | { deliverableId: string } | { templateActivityId: string };
  byTypeId: Record<string, string | null | undefined> | undefined;
  create: (tx: Prisma.TransactionClient, typeId: string, codeId: string) => Promise<void>;
}): Promise<void> {
  const raw = params.byTypeId;
  if (raw === undefined) return;

  const pairs: { typeId: string; codeId: string }[] = [];
  for (const [typeId, codeId] of Object.entries(raw)) {
    const tid = String(typeId).trim();
    const cid = codeId != null ? String(codeId).trim() : "";
    if (!tid) continue;
    if (!cid) continue;
    pairs.push({ typeId: tid, codeId: cid });
  }

  await prisma.$transaction(async (tx) => {
    await tx.activityCodeAssignment.deleteMany({
      where: { ...params.where, companyId: params.companyId },
    });
    for (const { typeId, codeId } of pairs) {
      const type = await tx.activityCodeType.findFirst({
        where: { id: typeId, companyId: params.companyId },
      });
      if (!type) {
        const err = new Error(`Unknown activity code type: ${typeId}`);
        (err as { status?: number }).status = 400;
        throw err;
      }
      const code = await tx.activityCode.findFirst({
        where: { id: codeId, companyId: params.companyId, typeId },
      });
      if (!code) {
        const err = new Error(`Code ${codeId} does not belong to type ${typeId}`);
        (err as { status?: number }).status = 400;
        throw err;
      }
      await params.create(tx, typeId, codeId);
    }
  });
}

/**
 * Replace all P6 activity code assignments for an activity (at most one code per type).
 * `byTypeId` maps activity code type id -> activity code id; omit or null clears that type.
 */
export async function replaceActivityCodeAssignmentsForActivity(params: {
  companyId: string;
  activityId: string;
  byTypeId: Record<string, string | null | undefined> | undefined;
}): Promise<void> {
  await replaceAssignmentsForOwner({
    companyId: params.companyId,
    where: { activityId: params.activityId },
    byTypeId: params.byTypeId,
    create: async (tx, typeId, codeId) => {
      await tx.activityCodeAssignment.create({
        data: {
          activityId: params.activityId,
          deliverableId: null,
          templateActivityId: null,
          companyId: params.companyId,
          typeId,
          codeId,
        },
      });
    },
  });
}

/**
 * Replace all P6 activity code assignments for a deliverable (exported as its own TASK row).
 */
export async function replaceActivityCodeAssignmentsForDeliverable(params: {
  companyId: string;
  deliverableId: string;
  byTypeId: Record<string, string | null | undefined> | undefined;
}): Promise<void> {
  await replaceAssignmentsForOwner({
    companyId: params.companyId,
    where: { deliverableId: params.deliverableId },
    byTypeId: params.byTypeId,
    create: async (tx, typeId, codeId) => {
      await tx.activityCodeAssignment.create({
        data: {
          activityId: null,
          deliverableId: params.deliverableId,
          templateActivityId: null,
          companyId: params.companyId,
          typeId,
          codeId,
        },
      });
    },
  });
}

/** Replace P6 codes on a fragnet default activity (template). */
export async function replaceActivityCodeAssignmentsForTemplate(params: {
  companyId: string;
  templateActivityId: string;
  byTypeId: Record<string, string | null | undefined> | undefined;
}): Promise<void> {
  await replaceAssignmentsForOwner({
    companyId: params.companyId,
    where: { templateActivityId: params.templateActivityId },
    byTypeId: params.byTypeId,
    create: async (tx, typeId, codeId) => {
      await tx.activityCodeAssignment.create({
        data: {
          activityId: null,
          deliverableId: null,
          templateActivityId: params.templateActivityId,
          companyId: params.companyId,
          typeId,
          codeId,
        },
      });
    },
  });
}

/** Copy template P6 assignments onto a materialized inherited activity. */
export async function copyTemplateCodesToActivity(params: {
  companyId: string;
  templateActivityId: string;
  activityId: string;
}): Promise<void> {
  const rows = await prisma.activityCodeAssignment.findMany({
    where: { templateActivityId: params.templateActivityId, companyId: params.companyId },
    select: { typeId: true, codeId: true },
  });
  const byTypeId: Record<string, string | null> = {};
  for (const r of rows) byTypeId[r.typeId] = r.codeId;
  await replaceActivityCodeAssignmentsForActivity({
    companyId: params.companyId,
    activityId: params.activityId,
    byTypeId,
  });
}
