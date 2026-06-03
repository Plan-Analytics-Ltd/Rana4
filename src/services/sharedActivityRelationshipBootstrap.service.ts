import { prisma } from "../utils/prisma.js";
import { compareActivityCodes } from "./activityCodeSequence.service.js";

/**
 * If shared activities exist in a fragnet, but were created without logic,
 * we can bootstrap their relationships from any existing non-shared relationship
 * patterns in the same fragnet using exact name matching.
 *
 * This stays deterministic and avoids creating duplicate logic chains.
 */
export async function bootstrapSharedActivityRelationshipsForFragnet(args: {
  fragnetId: string;
  companyId: string;
}): Promise<{ created: number }> {
  const { fragnetId, companyId } = args;

  const fragnet = await prisma.fragnet.findFirstOrThrow({
    where: { id: fragnetId, companyId },
    select: { projectId: true },
  });

  const shared = await prisma.activity.findMany({
    where: { companyId, fragnetId, isSharedAcrossDeliverables: true },
    select: { id: true, name: true, activityCode: true, createdAt: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (shared.length < 2) return { created: 0 };

  // MVP: one shared node per exact name (oldest wins).
  const sharedByName = new Map<string, { id: string; name: string }>();
  for (const a of shared) {
    const key = a.name.trim();
    if (!key) continue;
    if (!sharedByName.has(key)) sharedByName.set(key, { id: a.id, name: a.name });
  }
  if (sharedByName.size < 2) return { created: 0 };

  const names = [...sharedByName.keys()];
  const nameSet = new Set(names);

  const patterns = await prisma.relationship.findMany({
    where: { companyId, fragnetId },
    select: {
      relationshipType: true,
      lag: true,
      predecessorActivity: { select: { name: true, isSharedAcrossDeliverables: true } },
      successorActivity: { select: { name: true, isSharedAcrossDeliverables: true } },
    },
  });

  let created = 0;
  for (const p of patterns) {
    // Only learn from non-shared -> non-shared patterns.
    if (p.predecessorActivity.isSharedAcrossDeliverables) continue;
    if (p.successorActivity.isSharedAcrossDeliverables) continue;

    const predName = p.predecessorActivity.name.trim();
    const succName = p.successorActivity.name.trim();
    if (!nameSet.has(predName) || !nameSet.has(succName)) continue;
    const predShared = sharedByName.get(predName);
    const succShared = sharedByName.get(succName);
    if (!predShared || !succShared) continue;
    if (predShared.id === succShared.id) continue;

    const existing = await prisma.relationship.findFirst({
      where: {
        companyId,
        fragnetId,
        predecessorActivityId: predShared.id,
        successorActivityId: succShared.id,
        relationshipType: p.relationshipType,
      },
      select: { id: true },
    });
    if (existing) continue;

    await prisma.relationship.create({
      data: {
        companyId,
        projectId: fragnet.projectId,
        fragnetId,
        predecessorActivityId: predShared.id,
        successorActivityId: succShared.id,
        relationshipType: p.relationshipType,
        lag: p.lag,
      },
    });
    created++;
  }

  // Fallback: if we still have no shared→shared logic, create a single FS chain by activity code order.
  // This prevents the “no relationships” outcome while staying deterministic and deduped.
  const sharedCanonical = [...sharedByName.values()]
    .map((x) => x.id)
    .filter(Boolean);
  if (created === 0 && sharedCanonical.length >= 2) {
    const canonicalActs = shared
      .filter((a) => sharedByName.get(a.name.trim())?.id === a.id)
      .sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode));
    for (let i = 0; i < canonicalActs.length - 1; i++) {
      const pred = canonicalActs[i];
      const succ = canonicalActs[i + 1];
      if (!pred || !succ || pred.id === succ.id) continue;
      const existing = await prisma.relationship.findFirst({
        where: {
          companyId,
          fragnetId,
          predecessorActivityId: pred.id,
          successorActivityId: succ.id,
          relationshipType: "FS",
        },
        select: { id: true },
      });
      if (existing) continue;
      await prisma.relationship.create({
        data: {
          companyId,
          projectId: fragnet.projectId,
          fragnetId,
          predecessorActivityId: pred.id,
          successorActivityId: succ.id,
          relationshipType: "FS",
          lag: 0,
        },
      });
      created++;
    }
  }

  return { created };
}

