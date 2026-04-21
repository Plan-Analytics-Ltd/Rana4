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

  const parentId = wbs.project_wbs.wbs_id;

  for (const slice of wbs.deliverable_wbs_list) {
    rows.push({
      wbs_id: slice.wbs_id,
      wbs_short_name: slice.wbs_short_name,
      parent_wbs: parentId,
      wbs_name: slice.wbs_name,
    });
  }

  return rows;
}
