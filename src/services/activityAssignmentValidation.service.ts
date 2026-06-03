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

export type ActivityAssignmentIssue = {
  code: "ORPHAN_ACTIVITY" | "UNKNOWN_DELIVERABLE" | "CROSS_FRAGNET";
  message: string;
  activityId: string;
};

/** Collect every activity→deliverable problem (no fail-fast). */
export function collectActivityAssignmentIssues(
  standard: {
    id: string;
    fragnets: Array<{
      id: string;
      deliverables: Array<{ id: string; fragnetId: string | null }>;
      activities: Array<{ id: string; deliverableId: string | null; fragnetId: string }>;
    }>;
  }
): { result: ActivityAssignmentValidationResult; issues: ActivityAssignmentIssue[] } {
  const deliverables = standard.fragnets.flatMap((f) => f.deliverables);
  const deliverableById = new Map(deliverables.map((d) => [d.id, d]));
  const activities = standard.fragnets.flatMap((f) => f.activities);

  const orphanActivities: ActivityAssignmentValidationResult["orphanActivities"] = [];
  const unknownDeliverableActivities: ActivityAssignmentValidationResult["unknownDeliverableActivities"] = [];
  const crossFragnetMismatches: ActivityAssignmentValidationResult["crossFragnetMismatches"] = [];
  const issues: ActivityAssignmentIssue[] = [];

  for (const a of activities) {
    const did = a.deliverableId ? String(a.deliverableId).trim() : "";
    if (!did) {
      orphanActivities.push({ id: a.id, deliverableId: a.deliverableId ?? null });
      issues.push({
        code: "ORPHAN_ACTIVITY",
        message: `Activity ${a.id} is not linked to a deliverable`,
        activityId: a.id,
      });
      continue;
    }
    const d = deliverableById.get(did);
    if (!d) {
      unknownDeliverableActivities.push({ id: a.id, deliverableId: did });
      issues.push({
        code: "UNKNOWN_DELIVERABLE",
        message: `Activity ${a.id} references unknown deliverable ${did}`,
        activityId: a.id,
      });
      continue;
    }
    const deliverableFragnetId = d.fragnetId ?? a.fragnetId;
    if (deliverableFragnetId && String(deliverableFragnetId) !== String(a.fragnetId ?? "")) {
      crossFragnetMismatches.push({
        id: a.id,
        activityFragnetId: a.fragnetId,
        deliverableFragnetId: String(d.fragnetId ?? ""),
      });
      issues.push({
        code: "CROSS_FRAGNET",
        message: `Activity ${a.id} deliverable is in a different fragnet (activity.fragnetId=${a.fragnetId}, deliverable.fragnetId=${d.fragnetId ?? ""})`,
        activityId: a.id,
      });
    }
  }

  return {
    result: {
      standardId: standard.id,
      fragnetCount: standard.fragnets.length,
      deliverableCount: deliverables.length,
      activityCount: activities.length,
      orphanActivities,
      unknownDeliverableActivities,
      crossFragnetMismatches,
    },
    issues,
  };
}

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

  const { result, issues } = collectActivityAssignmentIssues(standard);
  if (issues.length > 0) throw new Error(issues[0]!.message);
  return result;
}

