import { prisma } from "../utils/prisma.js";

export type ActivityAssignmentValidationResult = {
  standardId: string;
  fragnetCount: number;
  deliverableCount: number;
  activityCount: number;
  orphanActivities: Array<{ id: string; deliverableId: string | null }>;
  unknownDeliverableActivities: Array<{ id: string; deliverableId: string }>;
  crossFragnetMismatches: Array<{ id: string; activityFragnetId: string; deliverableFragnetId: string }>;
};

/**
 * Strict validation for STANDARD export:
 * - Every activity must have a deliverableId
 * - Deliverable must exist under the same standard's fragnets
 * - Activity.fragnetId must match Deliverable.fragnetId (prevents cross-fragnet contamination)
 *
 * FAILS HARD with clear messages if invalid.
 */
export async function validateActivityAssignments(standardId: string): Promise<ActivityAssignmentValidationResult> {
  const sid = String(standardId ?? "").trim();
  if (!sid) throw new Error("validateActivityAssignments: standardId is required");

  const standard = await prisma.standard.findUnique({
    where: { id: sid },
    include: {
      fragnets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          deliverables: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
          activities: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
        },
      },
    },
  });

  if (!standard) throw new Error("validateActivityAssignments: Standard not found");

  const deliverables = standard.fragnets.flatMap((f) => f.deliverables);
  const deliverableById = new Map(deliverables.map((d) => [d.id, d]));

  const activities = standard.fragnets.flatMap((f) => f.activities);

  const orphanActivities: Array<{ id: string; deliverableId: string | null }> = [];
  const unknownDeliverableActivities: Array<{ id: string; deliverableId: string }> = [];
  const crossFragnetMismatches: Array<{ id: string; activityFragnetId: string; deliverableFragnetId: string }> = [];

  for (const a of activities) {
    const did = a.deliverableId ? String(a.deliverableId).trim() : "";
    if (!did) {
      orphanActivities.push({ id: a.id, deliverableId: a.deliverableId ?? null });
      continue;
    }
    const d = deliverableById.get(did);
    if (!d) {
      unknownDeliverableActivities.push({ id: a.id, deliverableId: did });
      continue;
    }
    if (String(d.fragnetId ?? "") !== String(a.fragnetId ?? "")) {
      crossFragnetMismatches.push({
        id: a.id,
        activityFragnetId: a.fragnetId,
        deliverableFragnetId: String(d.fragnetId ?? ""),
      });
    }
  }

  if (orphanActivities.length > 0) {
    throw new Error(`Activity ${orphanActivities[0]!.id} is not linked to a deliverable`);
  }
  if (unknownDeliverableActivities.length > 0) {
    const x = unknownDeliverableActivities[0]!;
    throw new Error(`Activity ${x.id} references unknown deliverable ${x.deliverableId}`);
  }
  if (crossFragnetMismatches.length > 0) {
    const x = crossFragnetMismatches[0]!;
    throw new Error(
      `Activity ${x.id} deliverable is in a different fragnet (activity.fragnetId=${x.activityFragnetId}, deliverable.fragnetId=${x.deliverableFragnetId})`
    );
  }

  return {
    standardId: standard.id,
    fragnetCount: standard.fragnets.length,
    deliverableCount: deliverables.length,
    activityCount: activities.length,
    orphanActivities,
    unknownDeliverableActivities,
    crossFragnetMismatches,
  };
}

