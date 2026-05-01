import type { Activity } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import type { DeliverableWithActivities } from "./deliverableActivityLink.service.js";
import {
  assertGeneratedWbsInvariants,
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

function normalizeForMatch(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDeliverableDescription(fragnetName: string, deliverableName: string): string {
  const raw = String(deliverableName ?? "").trim();
  const parts = raw.split(" - ");
  if (parts.length < 2) return raw;
  const prefix = String(parts[0] ?? "").trim();
  const rest = parts.slice(1).join(" - ").trim();
  // If prefix matches fragnet name, treat remainder as description; otherwise still prefer remainder.
  const f = normalizeForMatch(fragnetName);
  const p = normalizeForMatch(prefix);
  if (f && p && f === p) return rest || raw;
  return rest || raw;
}

function classifyGroup(description: string): string {
  const d = normalizeForMatch(description);
  const has = (s: string) => d.includes(normalizeForMatch(s));

  if (
    has("road") ||
    has("drainage") ||
    has("civils") ||
    has("cut & fill") ||
    has("hardstandings") ||
    has("footways")
  )
    return "Civils";
  if (has("structural") || has("foundation") || has("piling")) return "Structural";
  if (
    has("electrical") ||
    has("mechanical") ||
    has("hvac") ||
    has("mep") ||
    has("fire") ||
    has("lighting") ||
    has("cabling")
  )
    return "MEP";
  if (
    has("vrm") ||
    has("conveyor") ||
    has("gtu") ||
    has("stockpile") ||
    has("plant") ||
    has("equipment") ||
    has("locomotive")
  )
    return "Systems";
  if (has("survey")) return "Surveys";
  return "General";
}

function parseFragnetPrefixFromDeliverableName(name: string): string | null {
  const raw = String(name ?? "").trim();
  const parts = raw.split(" - ");
  if (parts.length < 2) return null;
  const prefix = String(parts[0] ?? "").trim();
  return prefix ? prefix : null;
}

const UNCLASSIFIED_FRAGNET_NAME = "Unclassified";

/**
 * Build a standard-wide WBS:
 * Project (root id=1) → Fragnet → Group → Deliverable → Activities (mapped via deliverableIdToWbsId).
 *
 * IMPORTANT: WBS ids are generated integers (no UUIDs).
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

  // STRICT: "No Fragnet" WBS must not exist.
  // However, projects may still contain deliverables with fragnetId=null. We deterministically infer the fragnet
  // from deliverable name prefix "[Fragnet] - ..." and attach under that fragnet at export-time.
  const unassigned = await prisma.deliverable.findMany({
    where: { projectId: standard.projectId, fragnetId: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: { activities: { orderBy: [{ activityCode: "asc" }, { id: "asc" }] } },
  });
  if (unassigned.length > 0) {
    const fragnetByName = new Map<string, FragnetWithDeliverables>();
    for (const f of fragnets) fragnetByName.set(normalizeForMatch(f.name), f);

    // Deterministic fallback bucket: keep hierarchy valid without introducing a "No Fragnet" WBS node.
    let unclassified = fragnetByName.get(normalizeForMatch(UNCLASSIFIED_FRAGNET_NAME));
    if (!unclassified) {
      unclassified = {
        id: "__UNCLASSIFIED__",
        name: UNCLASSIFIED_FRAGNET_NAME,
        createdAt: new Date(0),
        deliverables: [],
      };
      fragnets.push(unclassified);
      fragnetByName.set(normalizeForMatch(unclassified.name), unclassified);
    }

    for (const d of unassigned) {
      const prefix = parseFragnetPrefixFromDeliverableName(d.name);
      const key = normalizeForMatch(prefix ?? "");
      const target = key ? fragnetByName.get(key) : undefined;
      const resolved = target ?? unclassified;
      // Ensure we don't double-attach if DB data changes between queries.
      if (!resolved.deliverables.some((x) => x.id === d.id)) {
        resolved.deliverables.push(d as any);
      }
    }
  }

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
    wbs_nodes.push({
      kind: "FRAGNET",
      wbs_id: fragnetWbsId,
      parent_wbs_id: 1,
      wbs_short_name: String(fragnetWbsId),
      wbs_name: sanitizeWbsName(fragnet.name) || "Fragnet",
    });

    const groupKeyToWbsId = new Map<string, number>();

    const orderedDeliverables = sortByCreatedAtThenId(fragnet.deliverables);
    for (const d of orderedDeliverables) {
      // NEW LAYER: Group nodes under each fragnet, based on deliverable description keywords.
      const description = parseDeliverableDescription(fragnet.name, d.name);
      const groupName = classifyGroup(description);
      const groupKey = groupName.toLowerCase();
      let groupWbsId = groupKeyToWbsId.get(groupKey);
      if (!groupWbsId) {
        groupWbsId = ++currentWbsId;
        groupKeyToWbsId.set(groupKey, groupWbsId);
        wbs_nodes.push({
          kind: "GROUP",
          wbs_id: groupWbsId,
          parent_wbs_id: fragnetWbsId,
          wbs_short_name: String(groupWbsId),
          wbs_name: groupName,
        });
      }

      const deliverableWbsId = ++currentWbsId;
      const slice = {
        deliverable_id: d.id,
        wbs_id: deliverableWbsId,
        wbs_short_name: String(deliverableWbsId),
        wbs_name: sanitizeWbsName(d.name) || "Deliverable",
        activities: d.activities,
      };
      deliverable_wbs_list.push(slice);
      wbs_nodes.push({
        kind: "DELIVERABLE",
        wbs_id: deliverableWbsId,
        parent_wbs_id: groupWbsId,
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
  return merged;
}

