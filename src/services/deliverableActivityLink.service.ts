import type { Activity, Deliverable } from "@prisma/client";
import { prisma } from "../utils/prisma.js";

export type DeliverableFragnetMismatch = { kind: "not_found" } | { kind: "wrong_fragnet" };

/**
 * Ensures the deliverable exists and is linked to the given fragnet (same `fragnet_id`).
 * Deliverables with `fragnet_id` null cannot satisfy this check.
 */
export async function assertDeliverableOnFragnet(
  fragnetId: string,
  deliverableId: string
): Promise<{ ok: true; deliverable: Deliverable } | { ok: false; mismatch: DeliverableFragnetMismatch }> {
  const deliverable = await prisma.deliverable.findUnique({ where: { id: deliverableId } });
  if (!deliverable) return { ok: false, mismatch: { kind: "not_found" } };
  if (deliverable.fragnetId !== fragnetId) return { ok: false, mismatch: { kind: "wrong_fragnet" } };
  return { ok: true, deliverable };
}

export async function getActivitiesByDeliverable(deliverableId: string): Promise<Activity[]> {
  return prisma.activity.findMany({
    where: { deliverableId },
    orderBy: [{ activityCode: "asc" }, { id: "asc" }],
  });
}

export type DeliverableWithActivities = Deliverable & { activities: Activity[] };

/**
 * Deliverables whose optional `externalProjectId` matches (exact string after trim).
 * This is used for exports/integrations (e.g. P6 project id), not for access control.
 */
export async function getDeliverablesWithActivities(externalProjectId: string): Promise<DeliverableWithActivities[]> {
  const trimmed = externalProjectId.trim();
  if (trimmed === "") return [];
  return prisma.deliverable.findMany({
    where: { externalProjectId: trimmed },
    include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
