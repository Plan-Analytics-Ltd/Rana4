import type { Activity } from "@prisma/client";
import {
  getDeliverablesWithActivities,
  type DeliverableWithActivities,
} from "./deliverableActivityLink.service.js";

const WBS_NAME_MAX_LEN = 100;

/** Trim, collapse spaces, cap length (preserves prefixes/codes; no aggressive shortening). */
export function sanitizeWbsName(name: string): string {
  const collapsed = String(name).trim().replace(/\s+/g, " ");
  if (collapsed.length <= WBS_NAME_MAX_LEN) return collapsed;
  return collapsed.slice(0, WBS_NAME_MAX_LEN).replace(/\s+$/g, "").trim();
}

/** Stable order: `created_at` ascending, then `id` (same DB rows → same WBS order). */
export function sortDeliverablesForWbs(
  deliverables: DeliverableWithActivities[]
): DeliverableWithActivities[] {
  return [...deliverables].sort((a, b) => {
    const tA = new Date(a.createdAt).getTime();
    const tB = new Date(b.createdAt).getTime();
    if (tA !== tB) return tA - tB;
    return a.id.localeCompare(b.id);
  });
}

/** Project root WBS (synthetic). IDs are integers, not DB UUIDs. */
export type ProjectWbsRoot = {
  wbs_id: number;
  wbs_short_name: string;
  wbs_name: string;
};

/** Deliverable branch: `deliverable_id` links to DB only; `wbs_id` is generated. */
export type DeliverableWbsSlice = {
  deliverable_id: string;
  wbs_id: number;
  wbs_short_name: string;
  wbs_name: string;
  activities: Activity[];
};

export type WbsNodeKind = "FRAGNET" | "GROUP" | "DELIVERABLE";

/** Flat WBS node list (excluding root) so we can model intermediate levels like fragnets. */
export type WbsNode = {
  kind: WbsNodeKind;
  wbs_id: number;
  parent_wbs_id: number;
  wbs_short_name: string;
  wbs_name: string;
};

/** In-memory WBS tree + explicit deliverable → numeric WBS id map (required for XER / TASK). */
export type GeneratedWbs = {
  project_wbs: ProjectWbsRoot;
  /** All non-root WBS nodes in the hierarchy, including fragnets (STANDARD) and deliverables. */
  wbs_nodes: WbsNode[];
  deliverable_wbs_list: DeliverableWbsSlice[];
  deliverableIdToWbsId: Map<string, number>;
};

const DIGITS_ONLY = /^\d+$/;

function assertIntegerWbsId(label: string, v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1) {
    throw new Error(`${label}: wbs_id must be a positive integer, got ${String(v)}`);
  }
}

function assertNoUuidInWbsIdField(label: string, s: string): void {
  if (!DIGITS_ONLY.test(s)) {
    throw new Error(`${label}: wbs_id string must be digits only, got ${JSON.stringify(s)}`);
  }
}

/** Validates tree, map, and every activity maps to an integer wbs_id via the map. */
export function assertGeneratedWbsInvariants(wbs: GeneratedWbs): void {
  assertIntegerWbsId("project_wbs", wbs.project_wbs.wbs_id);
  assertNoUuidInWbsIdField("project_wbs", String(wbs.project_wbs.wbs_id));
  if (wbs.project_wbs.wbs_id !== 1) {
    throw new Error(`project_wbs: root wbs_id must be 1, got ${wbs.project_wbs.wbs_id}`);
  }
  if (wbs.project_wbs.wbs_short_name !== "1") {
    throw new Error(`project_wbs: root wbs_short_name must be "1", got ${JSON.stringify(wbs.project_wbs.wbs_short_name)}`);
  }

  if (!Array.isArray(wbs.wbs_nodes)) {
    throw new Error("GeneratedWbs: wbs_nodes must be an array");
  }

  const map = wbs.deliverableIdToWbsId;
  if (!(map instanceof Map)) {
    throw new Error("GeneratedWbs: deliverableIdToWbsId must be a Map");
  }
  if (map.size !== wbs.deliverable_wbs_list.length) {
    throw new Error(`GeneratedWbs: map size ${map.size} !== slice count ${wbs.deliverable_wbs_list.length}`);
  }

  const nodeById = new Map<number, WbsNode>();
  for (const n of wbs.wbs_nodes) {
    assertIntegerWbsId(`node ${n.kind}`, n.wbs_id);
    assertIntegerWbsId(`node ${n.kind} parent`, n.parent_wbs_id);
    assertNoUuidInWbsIdField(`node ${n.kind}`, String(n.wbs_id));
    assertNoUuidInWbsIdField(`node ${n.kind} parent`, String(n.parent_wbs_id));
    if (n.wbs_id === 1) throw new Error("WBS: exactly one root (wbs_id 1); wbs_nodes must not include wbs_id 1");
    if (nodeById.has(n.wbs_id)) throw new Error(`WBS: duplicate wbs_id ${n.wbs_id} in wbs_nodes`);
    if (n.parent_wbs_id === n.wbs_id) throw new Error(`WBS: node ${n.wbs_id} cannot parent itself`);
    nodeById.set(n.wbs_id, n);
  }

  for (const n of wbs.wbs_nodes) {
    if (n.parent_wbs_id !== 1 && !nodeById.has(n.parent_wbs_id)) {
      throw new Error(`WBS: node ${n.wbs_id} parent_wbs_id ${n.parent_wbs_id} does not exist`);
    }
  }

  const deliverableNodeIds = new Set(
    wbs.wbs_nodes.filter((n) => n.kind === "DELIVERABLE").map((n) => n.wbs_id)
  );

  for (let i = 0; i < wbs.deliverable_wbs_list.length; i++) {
    const slice = wbs.deliverable_wbs_list[i]!;
    assertIntegerWbsId(`slice ${slice.deliverable_id}`, slice.wbs_id);
    assertNoUuidInWbsIdField("slice", String(slice.wbs_id));
    if (!deliverableNodeIds.has(slice.wbs_id)) {
      throw new Error(`slice ${slice.deliverable_id}: wbs_id ${slice.wbs_id} missing from wbs_nodes DELIVERABLE entries`);
    }
    if (map.get(slice.deliverable_id) !== slice.wbs_id) {
      throw new Error(`deliverableIdToWbsId[${slice.deliverable_id}] !== slice.wbs_id ${slice.wbs_id}`);
    }
    for (const act of slice.activities) {
      const wid = map.get(act.deliverableId);
      if (wid === undefined || !Number.isInteger(wid)) {
        throw new Error(`activity ${act.id}: no integer wbs_id in map for deliverable_id ${act.deliverableId}`);
      }
      assertNoUuidInWbsIdField(`activity ${act.id} wbs`, String(wid));
      if (wid !== slice.wbs_id) {
        throw new Error(`activity ${act.id}: map wbs_id ${wid} !== slice ${slice.wbs_id}`);
      }
    }
  }

  // Backward-compat: for single-fragnet WBS generation (no intermediate nodes), enforce short_name sequence 2..N+1.
  const hasFragnetNodes = wbs.wbs_nodes.some((n) => n.kind === "FRAGNET");
  if (!hasFragnetNodes) {
    for (let i = 0; i < wbs.deliverable_wbs_list.length; i++) {
      const slice = wbs.deliverable_wbs_list[i]!;
      const expectShort = String(i + 2);
      if (slice.wbs_short_name !== expectShort) {
        throw new Error(
          `slice ${slice.deliverable_id}: wbs_short_name must be ${JSON.stringify(expectShort)}, got ${JSON.stringify(slice.wbs_short_name)}`
        );
      }
    }
  }
}

/**
 * P6-style unique WBS names among deliverable nodes: duplicate names get " (2)", " (3)", …
 * Numeric `wbs_id`, `wbs_short_name`, and `deliverableIdToWbsId` on slices are unchanged.
 */
export function withUniqueDeliverableWbsNames(wbs: GeneratedWbs): GeneratedWbs {
  const used = new Set<string>();
  const deliverable_wbs_list = wbs.deliverable_wbs_list.map((slice) => {
    const base = sanitizeWbsName(slice.wbs_name) || "Deliverable";
    let candidate = base;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${n})`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return { ...slice, wbs_name: candidate };
  });
  const wbs_nodes = wbs.wbs_nodes.map((n) => {
    if (n.kind !== "DELIVERABLE") return n;
    const matching = deliverable_wbs_list.find((s) => s.wbs_id === n.wbs_id);
    if (!matching) return n;
    return { ...n, wbs_name: matching.wbs_name };
  });
  return { ...wbs, deliverable_wbs_list, wbs_nodes };
}

/**
 * Builds WBS from scratch: root wbs_id=1, then incrementing integers per deliverable (stable list order).
 * Populates `deliverableIdToWbsId`. Does not use deliverable UUID as a WBS id.
 */
export function buildWbsFromDeliverables(
  projectKey: string,
  deliverables: DeliverableWithActivities[]
): GeneratedWbs {
  const ordered = (() => {
    const base = sortDeliverablesForWbs(deliverables);
    const splitGroup = (name: string): { group: string; child: string } => {
      const raw = sanitizeWbsName(name);
      const parts = raw.split(" - ");
      if (parts.length < 2) return { group: raw, child: raw };
      const group = sanitizeWbsName(parts[0] ?? raw) || raw;
      const child = sanitizeWbsName(parts.slice(1).join(" - ")) || raw;
      return { group, child };
    };
    return [...base].sort((a, b) => {
      const aG = splitGroup(a.name).group.toLowerCase();
      const bG = splitGroup(b.name).group.toLowerCase();
      if (aG !== bG) return aG.localeCompare(bG);
      const tA = new Date(a.createdAt).getTime();
      const tB = new Date(b.createdAt).getTime();
      if (tA !== tB) return tA - tB;
      return a.id.localeCompare(b.id);
    });
  })();
  let currentWbsId = 1;
  const rawProjectName = projectKey.trim() === "" ? "Project" : projectKey.trim();
  const project_wbs: ProjectWbsRoot = {
    wbs_id: currentWbsId,
    wbs_short_name: "1",
    wbs_name: sanitizeWbsName(rawProjectName) || "Project",
  };
  currentWbsId += 1;

  const deliverable_wbs_list = ordered.map((d, index) => {
    const wbs_id = currentWbsId;
    currentWbsId += 1;
    return {
      deliverable_id: d.id,
      wbs_id,
      wbs_short_name: String(index + 2),
      wbs_name: sanitizeWbsName(d.name) || "Deliverable",
      activities: d.activities,
    };
  });

  const wbs_nodes: WbsNode[] = deliverable_wbs_list.map((s) => ({
    kind: "DELIVERABLE",
    wbs_id: s.wbs_id,
    parent_wbs_id: project_wbs.wbs_id,
    wbs_short_name: s.wbs_short_name,
    wbs_name: s.wbs_name,
  }));

  const deliverableIdToWbsId = new Map<string, number>();
  for (const s of deliverable_wbs_list) {
    deliverableIdToWbsId.set(s.deliverable_id, s.wbs_id);
  }

  const merged = withUniqueDeliverableWbsNames({
    project_wbs,
    wbs_nodes,
    deliverable_wbs_list,
    deliverableIdToWbsId,
  });
  assertGeneratedWbsInvariants(merged);
  return merged;
}

/**
 * Load all deliverables tagged with `externalProjectId` and nested activities, then build WBS + map.
 */
export async function generateWBS(externalProjectId: string): Promise<GeneratedWbs> {
  const trimmed = externalProjectId.trim();
  const raw = await getDeliverablesWithActivities(trimmed);
  const deliverables = sortDeliverablesForWbs(raw);
  const wbs = buildWbsFromDeliverables(trimmed, deliverables);
  assertGeneratedWbsInvariants(wbs);
  return wbs;
}
