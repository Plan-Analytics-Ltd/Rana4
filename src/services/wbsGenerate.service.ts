import type { Activity } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
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
  /** Stage (fragnet) id; null only when deliverables hang directly under the project root (legacy / empty). */
  stageFragnetId: string | null;
  /** Stage display name (fragnet name), or project name for flat root. */
  stageDisplayName: string;
  /** Original deliverable name from DB before uniquify suffixes. */
  deliverableSourceName: string;
};

export type WbsNodeKind = "FRAGNET" | "DELIVERABLE";

/** Flat WBS node list (excluding root): stages (fragnets) and deliverables only. */
export type WbsNode = {
  kind: WbsNodeKind;
  wbs_id: number;
  parent_wbs_id: number;
  wbs_short_name: string;
  wbs_name: string;
  /** Present when `kind === "FRAGNET"` — ties WBS to DB stage for ID-driven lookups. */
  fragnetId?: string | null;
};

/** In-memory WBS tree + explicit deliverable → numeric WBS id map (required for XER / TASK). */
export type GeneratedWbs = {
  project_wbs: ProjectWbsRoot;
  /** All non-root WBS nodes: stages (fragnets) and deliverables. */
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

  // Backward-compat: for flat WBS (deliverables directly under project root only), enforce short_name sequence 2..N+1.
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
 * P6-style unique WBS names among deliverable nodes **per parent WBS** (same stage can reuse names
 * that another stage uses; duplicates within one stage still get " (2)", " (3)", …).
 * Numeric `wbs_id`, `wbs_short_name`, and `deliverableIdToWbsId` on slices are unchanged.
 */
export function withUniqueDeliverableWbsNames(wbs: GeneratedWbs): GeneratedWbs {
  const deliverableNodeByWbsId = new Map(
    wbs.wbs_nodes.filter((n) => n.kind === "DELIVERABLE").map((n) => [n.wbs_id, n])
  );
  const parentByDeliverableId = new Map<string, number>();
  for (const slice of wbs.deliverable_wbs_list) {
    const node = deliverableNodeByWbsId.get(slice.wbs_id);
    const parent = node?.parent_wbs_id ?? 1;
    parentByDeliverableId.set(slice.deliverable_id, parent);
  }

  const usedByParent = new Map<number, Set<string>>();

  const deliverable_wbs_list = wbs.deliverable_wbs_list.map((slice) => {
    const parent = parentByDeliverableId.get(slice.deliverable_id) ?? 1;
    let used = usedByParent.get(parent);
    if (!used) {
      used = new Set();
      usedByParent.set(parent, used);
    }
    const base = sanitizeWbsName(slice.deliverableSourceName) || "Deliverable";
    let candidate = base;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${base} (${n})`;
      n += 1;
    }
    used.add(candidate.toLowerCase());
    return { ...slice, wbs_name: candidate };
  });

  const wbs_nodes = wbs.wbs_nodes.map((node) => {
    if (node.kind !== "DELIVERABLE") return node;
    const matching = deliverable_wbs_list.find((s) => s.wbs_id === node.wbs_id);
    if (!matching) return node;
    return { ...node, wbs_name: matching.wbs_name };
  });

  return { ...wbs, deliverable_wbs_list, wbs_nodes };
}

/**
 * Deterministic lookup tables for export / validation (built from IDs + names already on slices — no fuzzy search).
 */
export type WbsDeterministicLookups = {
  /** `stageFragnetId` (or "__ROOT__") -> numeric WBS id of that stage node (or project root for flat). */
  stageWbsIdByFragnetKey: Map<string, number>;
  /** `(stageFragnetKey, deliverable_id)` -> deliverable leaf WBS id */
  deliverableWbsIdByStageAndDeliverableId: Map<string, number>;
};

export function buildDeterministicWbsLookups(wbs: GeneratedWbs): WbsDeterministicLookups {
  const stageWbsIdByFragnetKey = new Map<string, number>();
  const deliverableWbsIdByStageAndDeliverableId = new Map<string, number>();

  stageWbsIdByFragnetKey.set("__ROOT__", wbs.project_wbs.wbs_id);

  for (const n of wbs.wbs_nodes) {
    if (n.kind === "FRAGNET" && n.fragnetId) {
      stageWbsIdByFragnetKey.set(n.fragnetId, n.wbs_id);
    }
  }

  for (const s of wbs.deliverable_wbs_list) {
    const stageKey = s.stageFragnetId ?? "__ROOT__";
    deliverableWbsIdByStageAndDeliverableId.set(`${stageKey}\0${s.deliverable_id}`, s.wbs_id);
  }

  return {
    stageWbsIdByFragnetKey,
    deliverableWbsIdByStageAndDeliverableId,
  };
}

/**
 * Project → Stage (fragnet) → Deliverable → activities (via slice.activities).
 * Use this for single-fragnet / fragnet exports so TASK WBS always sits under a stage node.
 */
export function buildWbsForFragnetExport(
  projectKey: string,
  stage: { id: string; name: string },
  deliverables: DeliverableWithActivities[]
): GeneratedWbs {
  const ordered = sortDeliverablesForWbs(deliverables);
  let currentWbsId = 1;
  const rawProjectName = projectKey.trim() === "" ? "Project" : projectKey.trim();
  const project_wbs: ProjectWbsRoot = {
    wbs_id: currentWbsId,
    wbs_short_name: "1",
    wbs_name: sanitizeWbsName(rawProjectName) || "Project",
  };
  currentWbsId += 1;
  const fragnetWbsId = currentWbsId;
  currentWbsId += 1;

  const stageDisplay = sanitizeWbsName(stage.name) || stage.name;

  const wbs_nodes: WbsNode[] = [
    {
      kind: "FRAGNET",
      wbs_id: fragnetWbsId,
      parent_wbs_id: project_wbs.wbs_id,
      wbs_short_name: String(fragnetWbsId),
      wbs_name: stageDisplay,
      fragnetId: stage.id,
    },
  ];

  const deliverable_wbs_list = ordered.map((d) => {
    const wbs_id = currentWbsId;
    currentWbsId += 1;
    const src = sanitizeWbsName(d.name) || d.name;
    return {
      deliverable_id: d.id,
      wbs_id,
      wbs_short_name: String(wbs_id),
      wbs_name: src,
      activities: d.activities,
      stageFragnetId: stage.id,
      stageDisplayName: stageDisplay,
      deliverableSourceName: src,
    };
  });

  for (const s of deliverable_wbs_list) {
    wbs_nodes.push({
      kind: "DELIVERABLE",
      wbs_id: s.wbs_id,
      parent_wbs_id: fragnetWbsId,
      wbs_short_name: s.wbs_short_name,
      wbs_name: s.wbs_name,
    });
  }

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
  buildDeterministicWbsLookups(merged);
  return merged;
}

/**
 * Legacy flat WBS: project root → deliverable leaves only (no stage node).
 * Prefer {@link buildWbsForFragnetExport} whenever deliverables belong to a fragnet.
 */
export function buildWbsFromDeliverables(
  projectKey: string,
  deliverables: DeliverableWithActivities[]
): GeneratedWbs {
  const ordered = sortDeliverablesForWbs(deliverables);
  let currentWbsId = 1;
  const rawProjectName = projectKey.trim() === "" ? "Project" : projectKey.trim();
  const project_wbs: ProjectWbsRoot = {
    wbs_id: currentWbsId,
    wbs_short_name: "1",
    wbs_name: sanitizeWbsName(rawProjectName) || "Project",
  };
  currentWbsId += 1;

  const stageDisplay = project_wbs.wbs_name;

  const deliverable_wbs_list = ordered.map((d, index) => {
    const wbs_id = currentWbsId;
    currentWbsId += 1;
    const src = sanitizeWbsName(d.name) || d.name;
    return {
      deliverable_id: d.id,
      wbs_id,
      wbs_short_name: String(index + 2),
      wbs_name: src,
      activities: d.activities,
      stageFragnetId: null,
      stageDisplayName: stageDisplay,
      deliverableSourceName: src,
    };
  });

  const wbs_nodes: WbsNode[] = deliverable_wbs_list.map((s) => ({
    kind: "DELIVERABLE" as const,
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
  if (deliverable_wbs_list.length > 0) {
    buildDeterministicWbsLookups(merged);
  }
  return merged;
}

/**
 * Load all deliverables tagged with `externalProjectId` and nested activities, then build WBS + map.
 * Requires a single stage (fragnet) for all deliverables when the list is non-empty.
 */
export async function generateWBS(externalProjectId: string): Promise<GeneratedWbs> {
  const trimmed = externalProjectId.trim();
  const raw = await getDeliverablesWithActivities(trimmed);
  const deliverables = sortDeliverablesForWbs(raw);
  if (deliverables.length === 0) {
    const wbs = buildWbsFromDeliverables(trimmed, []);
    assertGeneratedWbsInvariants(wbs);
    return wbs;
  }
  if (deliverables.some((d) => !d.fragnetId)) {
    throw new Error("generateWBS: every deliverable must belong to a stage (fragnet) when using externalProjectId WBS generation");
  }
  const fragnetIds = [...new Set(deliverables.map((d) => d.fragnetId).filter(Boolean))] as string[];
  if (fragnetIds.length !== 1) {
    throw new Error(
      `generateWBS: expected exactly one stage (fragnet) across deliverables; found ${fragnetIds.length}. Use standard export for multi-stage WBS.`
    );
  }
  const fid = fragnetIds[0]!;
  const fragnet = await prisma.fragnet.findFirst({ where: { id: fid } });
  if (!fragnet) {
    throw new Error(`generateWBS: fragnet ${fid} not found`);
  }
  const wbs = buildWbsForFragnetExport(trimmed || fragnet.name, { id: fragnet.id, name: fragnet.name }, deliverables);
  assertGeneratedWbsInvariants(wbs);
  return wbs;
}
