import type { GeneratedWbs } from "./wbsGenerate.service.js";

export type HumanReadableWbsRow = {
  wbs_id: number;
  wbs_short_name: string;
  parent_wbs: number | null;
  wbs_name: string;
};

function normalizeRootWbsCode(rootWbsCode: string | undefined, wbs: GeneratedWbs): string {
  const trimmed = String(rootWbsCode ?? "").trim();
  if (trimmed) return trimmed;
  const fallback = String(wbs.project_wbs.wbs_name ?? "").trim();
  return fallback || "Project";
}

/**
 * Build XER-aligned WBS codes for spreadsheet import, matching PROJWBS semantics:
 * code = `${ProjectCode}.${wbs_short_name}.{wbs_short_name}...` following the parent chain.
 *
 * Example (from XER):
 * - Root: NEWPROJ-7090
 * - Node wbs_short_name=2 under root: NEWPROJ-7090.2
 * - Node wbs_short_name=11 under 2: NEWPROJ-7090.2.11
 * - Node wbs_short_name=12 under 11: NEWPROJ-7090.2.11.12
 *
 * IMPORTANT:
 * - Uses the actual WBS tree via `parent_wbs_id` (same structure exported to XER PROJWBS).
 * - Includes GROUP nodes (since they exist in the XER hierarchy and therefore in the expected WBS codes).
 * - Uses `wbs_short_name` tokens from nodes (deliverables can be overridden by slice short_name if needed).
 */
export function buildXerAlignedWbsCodeMap(wbs: GeneratedWbs, projectCode?: string): Map<number, string> {
  const rootCode = normalizeRootWbsCode(projectCode, wbs);

  const sliceShortNameByWbsId = new Map<number, string>();
  for (const s of wbs.deliverable_wbs_list) sliceShortNameByWbsId.set(s.wbs_id, s.wbs_short_name);

  const nodeById = new Map<number, (typeof wbs.wbs_nodes)[number]>();
  for (const n of wbs.wbs_nodes) nodeById.set(n.wbs_id, n);

  const tokenForNode = (wbsId: number): string => {
    const n = nodeById.get(wbsId);
    if (!n) return String(wbsId);
    const fromSlice = sliceShortNameByWbsId.get(wbsId);
    // Deliverables can be overridden by slice short_name, but in practice both are numeric strings.
    return String(fromSlice ?? n.wbs_short_name ?? wbsId).trim();
  };

  const out = new Map<number, string>();
  out.set(wbs.project_wbs.wbs_id, rootCode);

  const resolving = new Set<number>();
  const resolve = (wbsId: number): string => {
    if (wbsId === wbs.project_wbs.wbs_id) return rootCode;
    const cached = out.get(wbsId);
    if (cached) return cached;
    if (resolving.has(wbsId)) {
      // Cycle shouldn't exist (invariants validate), but fail safe.
      return `${rootCode}.${tokenForNode(wbsId)}`;
    }
    resolving.add(wbsId);
    const n = nodeById.get(wbsId);
    if (!n) {
      const c = `${rootCode}.${tokenForNode(wbsId)}`;
      out.set(wbsId, c);
      resolving.delete(wbsId);
      return c;
    }
    const parentId = n.parent_wbs_id;
    const parentCode = parentId === wbs.project_wbs.wbs_id ? rootCode : resolve(parentId);
    const token = tokenForNode(wbsId);
    const code = `${parentCode}.${token}`;
    out.set(wbsId, code);
    resolving.delete(wbsId);
    return code;
  };

  // Precompute for all nodes.
  for (const n of wbs.wbs_nodes) resolve(n.wbs_id);
  return out;
}

export function generateHumanReadableWBS(wbs: GeneratedWbs, rootWbsCode?: string): HumanReadableWbsRow[] {
  const codeById = buildXerAlignedWbsCodeMap(wbs, rootWbsCode);
  const rootCode = codeById.get(wbs.project_wbs.wbs_id) ?? normalizeRootWbsCode(rootWbsCode, wbs);

  const rows: HumanReadableWbsRow[] = [
    {
      wbs_id: wbs.project_wbs.wbs_id,
      wbs_short_name: rootCode,
      parent_wbs: null,
      wbs_name: wbs.project_wbs.wbs_name,
    },
  ];

  const sliceNameByWbsId = new Map<number, { wbs_short_name: string; wbs_name: string }>();
  for (const s of wbs.deliverable_wbs_list) {
    sliceNameByWbsId.set(s.wbs_id, { wbs_short_name: s.wbs_short_name, wbs_name: s.wbs_name });
  }

  const ordered = [...wbs.wbs_nodes].sort((a, b) => a.wbs_id - b.wbs_id);
  for (const n of ordered) {
    const fromSlice = sliceNameByWbsId.get(n.wbs_id);
    rows.push({
      wbs_id: n.wbs_id,
      wbs_short_name: codeById.get(n.wbs_id) ?? fromSlice?.wbs_short_name ?? n.wbs_short_name,
      parent_wbs: n.parent_wbs_id,
      wbs_name: fromSlice?.wbs_name ?? n.wbs_name,
    });
  }

  return rows;
}
