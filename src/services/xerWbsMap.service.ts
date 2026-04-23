import type { GeneratedWbs } from "./wbsGenerate.service.js";
import { assertGeneratedWbsInvariants } from "./wbsGenerate.service.js";

/** XER-oriented PROJWBS row (in-memory mapping only). */
export type XerProjwbsRow = {
  wbs_id: string;
  proj_id: string;
  parent_wbs_id: string | null;
  wbs_name: string;
  wbs_short_name: string;
};

/** XER-oriented TASK row: `wbs_id` is digits only (numeric WBS node). */
export type XerTaskRow = {
  task_id: string;
  wbs_id: string;
};

export type XerWbsMapping = {
  projwbs: XerProjwbsRow[];
  tasks: XerTaskRow[];
};

const DIGITS_ONLY = /^\d+$/;

function resolveProjId(struct: GeneratedWbs): string {
  const name = struct.project_wbs.wbs_name.trim();
  if (name !== "" && name !== "Project") return name;
  return String(struct.project_wbs.wbs_id);
}

function assertProjwbsHierarchy(rows: XerProjwbsRow[]): void {
  const roots = rows.filter((r) => r.wbs_id === "1");
  if (roots.length !== 1) {
    throw new Error(`mapToXER: expected exactly one root PROJWBS (wbs_id 1), got ${roots.length}`);
  }
  const r0 = rows[0];
  if (!r0 || r0.wbs_id !== "1" || r0.parent_wbs_id !== null) {
    throw new Error("mapToXER: first PROJWBS row must be root (wbs_id 1, parent_wbs_id null)");
  }
  if (r0.wbs_short_name !== "1") {
    throw new Error(`mapToXER: root wbs_short_name must be "1", got ${JSON.stringify(r0.wbs_short_name)}`);
  }
  if (!r0.proj_id) {
    throw new Error("mapToXER: root PROJWBS missing proj_id");
  }
  const byId = new Map(rows.map((r) => [r.wbs_id, r]));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i]!;
    if (r.parent_wbs_id !== "1" && (r.parent_wbs_id == null || !byId.has(r.parent_wbs_id))) {
      throw new Error(
        `mapToXER: PROJWBS wbs_id ${r.wbs_id} has missing parent_wbs_id ${JSON.stringify(r.parent_wbs_id)}`
      );
    }
    if (!r.proj_id) throw new Error(`mapToXER: PROJWBS wbs_id ${r.wbs_id} missing proj_id`);
    if (!r.wbs_name) throw new Error(`mapToXER: PROJWBS wbs_id ${r.wbs_id} missing wbs_name`);
    if (!r.wbs_short_name) throw new Error(`mapToXER: PROJWBS wbs_id ${r.wbs_id} missing wbs_short_name`);
  }
}

function assertXerMapping(m: XerWbsMapping): void {
  for (const r of m.projwbs) {
    if (!DIGITS_ONLY.test(r.wbs_id)) {
      throw new Error(`mapToXER: PROJWBS wbs_id must be integer string, got ${JSON.stringify(r.wbs_id)}`);
    }
    if (r.parent_wbs_id !== null && !DIGITS_ONLY.test(r.parent_wbs_id)) {
      throw new Error(`mapToXER: PROJWBS parent_wbs_id must be integer string or null, got ${JSON.stringify(r.parent_wbs_id)}`);
    }
  }
  for (const t of m.tasks) {
    if (!DIGITS_ONLY.test(t.wbs_id)) {
      throw new Error(`mapToXER: TASK wbs_id must be integer string, got ${JSON.stringify(t.wbs_id)}`);
    }
  }
}

/**
 * PROJWBS from slices; TASK `wbs_id` only from `deliverableIdToWbsId.get(activity.deliverableId)` (numeric).
 */
export function mapToXER(wbsStructure: GeneratedWbs): XerWbsMapping {
  assertGeneratedWbsInvariants(wbsStructure);

  const map = wbsStructure.deliverableIdToWbsId;
  const proj_id = resolveProjId(wbsStructure);
  const root = wbsStructure.project_wbs;

  const projwbs: XerProjwbsRow[] = [
    {
      wbs_id: String(root.wbs_id),
      proj_id,
      parent_wbs_id: null,
      wbs_name: root.wbs_name,
      wbs_short_name: root.wbs_short_name,
    },
  ];

  const sliceByWbsId = new Map<number, { wbs_name: string; wbs_short_name: string }>();
  for (const slice of wbsStructure.deliverable_wbs_list) {
    const mapped = map.get(slice.deliverable_id);
    if (mapped !== slice.wbs_id) throw new Error("mapToXER: slice vs deliverableIdToWbsId mismatch");
    sliceByWbsId.set(slice.wbs_id, { wbs_name: slice.wbs_name, wbs_short_name: slice.wbs_short_name });
  }

  const orderedNodes = [...wbsStructure.wbs_nodes].sort((a, b) => a.wbs_id - b.wbs_id);
  for (const n of orderedNodes) {
    const slice = sliceByWbsId.get(n.wbs_id);
    projwbs.push({
      wbs_id: String(n.wbs_id),
      proj_id,
      parent_wbs_id: String(n.parent_wbs_id),
      wbs_name: slice?.wbs_name ?? n.wbs_name,
      wbs_short_name: slice?.wbs_short_name ?? n.wbs_short_name,
    });
  }

  const tasks: XerTaskRow[] = [];
  for (const slice of wbsStructure.deliverable_wbs_list) {
    for (const activity of slice.activities) {
      const wbsIdNum = map.get(activity.deliverableId);
      if (wbsIdNum === undefined || !Number.isInteger(wbsIdNum)) {
        throw new Error(`mapToXER: activity ${activity.id} missing integer wbs for deliverable_id ${activity.deliverableId}`);
      }
      tasks.push({
        task_id: activity.id,
        wbs_id: String(wbsIdNum),
      });
    }
  }

  assertProjwbsHierarchy(projwbs);

  const out: XerWbsMapping = { projwbs, tasks };
  assertXerMapping(out);
  return out;
}
