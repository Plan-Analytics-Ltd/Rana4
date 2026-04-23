import type { GeneratedWbs } from "./wbsGenerate.service.js";

export type HumanReadableWbsRow = {
  wbs_id: number;
  wbs_short_name: string;
  parent_wbs: number | null;
  wbs_name: string;
};

export function generateHumanReadableWBS(wbs: GeneratedWbs): HumanReadableWbsRow[] {
  const rows: HumanReadableWbsRow[] = [
    {
      wbs_id: wbs.project_wbs.wbs_id,
      wbs_short_name: "1",
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
      wbs_short_name: fromSlice?.wbs_short_name ?? n.wbs_short_name,
      parent_wbs: n.parent_wbs_id,
      wbs_name: fromSlice?.wbs_name ?? n.wbs_name,
    });
  }

  return rows;
}
