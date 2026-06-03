import type { DeliverableWithActivities } from "./deliverableActivityLink.service.js";
import { prisma } from "../utils/prisma.js";
import type { StandardFragnetForExport } from "./export.service.js";
import type { AssignedResourceStored } from "./rateCard.js";
import { assignmentsFromDb } from "./rateCard.js";

/** Synthetic stage id for project-level deliverables (no fragnet) in WBS / P6 export. */
export const EXPORT_UNASSIGNED_STAGE_ID = "__unassigned__";

export const EXPORT_UNASSIGNED_STAGE_NAME = "Unassigned deliverables";

export async function loadProjectUnassignedDeliverables(
  projectId: string,
  companyId: string
): Promise<DeliverableWithActivities[]> {
  return prisma.deliverable.findMany({
    where: { projectId, companyId, fragnetId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
  });
}

export async function buildUnassignedFragnetForExport(
  projectId: string,
  companyId: string
): Promise<StandardFragnetForExport | null> {
  const rows = await loadProjectUnassignedDeliverables(projectId, companyId);
  if (rows.length === 0) return null;

  const deliverables = await Promise.all(
    rows.map(async (d) => ({
      id: d.id,
      name: d.name,
      bestDuration: d.bestDuration,
      likelyDuration: d.likelyDuration,
      createdAt: d.createdAt,
      assignedResources: await assignmentsFromDb(companyId, d.assignedResources),
    }))
  );

  const activities = await Promise.all(
    rows.flatMap((d) => d.activities).map(async (a) => ({
      id: a.id,
      deliverableId: a.deliverableId,
      name: a.name,
      bestDuration: a.bestDuration,
      likelyDuration: a.likelyDuration,
      createdAt: a.createdAt,
      assignedResources: await assignmentsFromDb(companyId, a.assignedResources),
    }))
  );

  return {
    id: EXPORT_UNASSIGNED_STAGE_ID,
    deliverables,
    activities,
    relationships: [],
    deliverableRelationships: [],
    deliverableActivityRelationships: [],
  };
}
