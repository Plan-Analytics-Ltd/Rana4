import type { Activity } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import type { DeliverableWithActivities } from "./deliverableActivityLink.service.js";
import {
  EXPORT_UNASSIGNED_STAGE_ID,
  EXPORT_UNASSIGNED_STAGE_NAME,
  loadProjectUnassignedDeliverables,
} from "./exportUnassignedDeliverables.service.js";
import {
  assertGeneratedWbsInvariants,
  buildDeterministicWbsLookups,
  sanitizeWbsName,
  withUniqueDeliverableWbsNames,
  type GeneratedWbs,
  type WbsNode,
} from "./wbsGenerate.service.js";

export type FragnetWithDeliverables = {
  id: string;
  name: string;
  createdAt: Date;
  deliverables: DeliverableWithActivities[];
};

/**
 * Build a fragnet-scoped activity pool.
 * IMPORTANT: NEVER include activities from other fragnets.
 */
export function buildFragnetActivitiesMap(
  fragnets: FragnetWithDeliverables[]
): Map<string, Activity[]> {
  const fragnetActivitiesMap = new Map<string, Activity[]>();
  for (const fragnet of fragnets) {
    const activities = fragnet.deliverables.flatMap((d) => d.activities);
    fragnetActivitiesMap.set(fragnet.id, activities);
  }
  return fragnetActivitiesMap;
}

function sortByCreatedAtThenId<T extends { createdAt: Date; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    if (tA !== tB) return tA - tB;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Build a standard-wide WBS:
 * Project (root id=1) → Stage / Fragnet → Deliverable → Activities (mapped via deliverableIdToWbsId).
 *
 * IMPORTANT: WBS ids are generated integers (no UUIDs).
 * Deliverables without a fragnet are grouped under a synthetic "Unassigned deliverables" stage.
 */
export async function generateWbsFromFragnets(standardId: string): Promise<GeneratedWbs> {
  const sid = String(standardId ?? "").trim();
  if (!sid) throw new Error("generateWbsFromFragnets: standardId is required");

  const standard = await prisma.standard.findUnique({
    where: { id: sid },
    include: {
      fragnets: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          deliverables: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
          },
        },
      },
    },
  });

  if (!standard) throw new Error("generateWbsFromFragnets: Standard not found");

  const fragnets: FragnetWithDeliverables[] = standard.fragnets.map((f) => ({
    id: f.id,
    name: f.name,
    createdAt: f.createdAt,
    deliverables: f.deliverables,
  }));

  let currentWbsId = 1;
  const project_wbs = {
    wbs_id: 1,
    wbs_short_name: "1",
    wbs_name: sanitizeWbsName(standard.name) || "Project",
  } as const;

  const wbs_nodes: WbsNode[] = [];
  const deliverable_wbs_list: GeneratedWbs["deliverable_wbs_list"] = [];
  const deliverableIdToWbsId = new Map<string, number>();

  for (const fragnet of sortByCreatedAtThenId(fragnets)) {
    const fragnetWbsId = ++currentWbsId;
    const stageDisplay = sanitizeWbsName(fragnet.name) || fragnet.name;
    wbs_nodes.push({
      kind: "FRAGNET",
      wbs_id: fragnetWbsId,
      parent_wbs_id: 1,
      wbs_short_name: String(fragnetWbsId),
      wbs_name: stageDisplay,
      fragnetId: fragnet.id,
    });

    const orderedDeliverables = sortByCreatedAtThenId(fragnet.deliverables);
    for (const d of orderedDeliverables) {
      const deliverableWbsId = ++currentWbsId;
      const src = sanitizeWbsName(d.name) || d.name;
      const slice = {
        deliverable_id: d.id,
        wbs_id: deliverableWbsId,
        wbs_short_name: String(deliverableWbsId),
        wbs_name: src,
        activities: d.activities,
        stageFragnetId: fragnet.id,
        stageDisplayName: stageDisplay,
        deliverableSourceName: src,
      };
      deliverable_wbs_list.push(slice);
      wbs_nodes.push({
        kind: "DELIVERABLE",
        wbs_id: deliverableWbsId,
        parent_wbs_id: fragnetWbsId,
        wbs_short_name: slice.wbs_short_name,
        wbs_name: slice.wbs_name,
      });
      deliverableIdToWbsId.set(d.id, deliverableWbsId);
    }
  }

  const unassigned = await loadProjectUnassignedDeliverables(standard.projectId, standard.companyId);
  if (unassigned.length > 0) {
    const fragnetWbsId = ++currentWbsId;
    const stageDisplay = EXPORT_UNASSIGNED_STAGE_NAME;
    wbs_nodes.push({
      kind: "FRAGNET",
      wbs_id: fragnetWbsId,
      parent_wbs_id: 1,
      wbs_short_name: String(fragnetWbsId),
      wbs_name: stageDisplay,
      fragnetId: EXPORT_UNASSIGNED_STAGE_ID,
    });

    for (const d of sortByCreatedAtThenId(unassigned)) {
      const deliverableWbsId = ++currentWbsId;
      const src = sanitizeWbsName(d.name) || d.name;
      const slice = {
        deliverable_id: d.id,
        wbs_id: deliverableWbsId,
        wbs_short_name: String(deliverableWbsId),
        wbs_name: src,
        activities: d.activities,
        stageFragnetId: EXPORT_UNASSIGNED_STAGE_ID,
        stageDisplayName: stageDisplay,
        deliverableSourceName: src,
      };
      deliverable_wbs_list.push(slice);
      wbs_nodes.push({
        kind: "DELIVERABLE",
        wbs_id: deliverableWbsId,
        parent_wbs_id: fragnetWbsId,
        wbs_short_name: slice.wbs_short_name,
        wbs_name: slice.wbs_name,
      });
      deliverableIdToWbsId.set(d.id, deliverableWbsId);
    }
  }

  const merged = withUniqueDeliverableWbsNames({
    project_wbs: { ...project_wbs },
    wbs_nodes,
    deliverable_wbs_list,
    deliverableIdToWbsId,
  });
  assertGeneratedWbsInvariants(merged);
  buildDeterministicWbsLookups(merged);
  return merged;
}
