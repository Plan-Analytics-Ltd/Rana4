import { prisma } from "../utils/prisma.js";

/**
 * Replace all P6 activity code assignments for an activity (at most one code per type).
 * `byTypeId` maps activity code type id -> activity code id; omit or null clears that type.
 */
export async function replaceActivityCodeAssignmentsForActivity(params: {
  companyId: string;
  activityId: string;
  byTypeId: Record<string, string | null | undefined> | undefined;
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
      where: { activityId: params.activityId, companyId: params.companyId },
    });
    for (const { typeId, codeId } of pairs) {
      const type = await tx.activityCodeType.findFirst({
        where: { id: typeId, companyId: params.companyId },
      });
      if (!type) {
        const err = new Error(`Unknown activity code type: ${typeId}`);
        (err as any).status = 400;
        throw err;
      }
      const code = await tx.activityCode.findFirst({
        where: { id: codeId, companyId: params.companyId, typeId },
      });
      if (!code) {
        const err = new Error(`Code ${codeId} does not belong to type ${typeId}`);
        (err as any).status = 400;
        throw err;
      }
      await tx.activityCodeAssignment.create({
        data: {
          activityId: params.activityId,
          deliverableId: null,
          companyId: params.companyId,
          typeId,
          codeId,
        },
      });
    }
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
      where: { deliverableId: params.deliverableId, companyId: params.companyId },
    });
    for (const { typeId, codeId } of pairs) {
      const type = await tx.activityCodeType.findFirst({
        where: { id: typeId, companyId: params.companyId },
      });
      if (!type) {
        const err = new Error(`Unknown activity code type: ${typeId}`);
        (err as any).status = 400;
        throw err;
      }
      const code = await tx.activityCode.findFirst({
        where: { id: codeId, companyId: params.companyId, typeId },
      });
      if (!code) {
        const err = new Error(`Code ${codeId} does not belong to type ${typeId}`);
        (err as any).status = 400;
        throw err;
      }
      await tx.activityCodeAssignment.create({
        data: {
          activityId: null,
          deliverableId: params.deliverableId,
          companyId: params.companyId,
          typeId,
          codeId,
        },
      });
    }
  });
}
