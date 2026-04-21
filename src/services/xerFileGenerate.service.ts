import { createHash } from "node:crypto";
import type { Activity } from "@prisma/client";
import { generateWBS } from "./wbsGenerate.service.js";
import { validateGeneratedWbsStructure } from "./wbsExportValidation.service.js";
import { mapToXER } from "./xerWbsMap.service.js";

function tabLine(parts: (string | number | null | undefined)[]): string {
  return parts
    .map((v) => {
      if (v === null || v === undefined) return "";
      return String(v).replace(/\t/g, " ").replace(/\r?\n/g, " ");
    })
    .join("\t");
}

/** Deterministic GUID-style id for XER rows (stable for the same seed). */
function xerGuid(seed: string): string {
  const h = createHash("md5").update(seed).digest("hex").toUpperCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function ermhdrTimestamp(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

/**
 * Build a tab-delimited Primavera-style XER fragment: ERMHDR, PROJWBS, optional TASK.
 * Calls {@link generateWBS} then {@link mapToXER}. Does not write to disk.
 */
export async function generateXERFile(projectId: string): Promise<string> {
  const wbs = await generateWBS(projectId);
  const structureIssues = validateGeneratedWbsStructure(wbs);
  if (structureIssues.length > 0) {
    throw new Error(
      `WBS structure validation failed: ${structureIssues.map((i) => i.message).join("; ")}`
    );
  }
  const { projwbs, tasks } = mapToXER(wbs);

  const activityById = new Map<string, Activity>();
  for (const slice of wbs.deliverable_wbs_list) {
    for (const a of slice.activities) {
      activityById.set(a.id, a);
    }
  }

  const projId = projwbs[0]?.proj_id ?? String(wbs.project_wbs.wbs_id);
  const lines: string[] = [];

  lines.push(
    tabLine([
      "ERMHDR",
      "21",
      "0.0",
      ermhdrTimestamp(new Date()),
      "Rana4",
      "Rana4",
      wbs.project_wbs.wbs_name,
      "XER",
      "1",
      "UTF-8",
      "\\SCHED$",
      "0",
      "0",
    ])
  );

  lines.push(tabLine(["%T", "PROJWBS"]));
  lines.push(
    tabLine([
      "%F",
      "wbs_id",
      "proj_id",
      "parent_wbs_id",
      "wbs_name",
      "wbs_short_name",
      "seq_num",
      "guid",
      "status_code",
      "proj_node_flag",
      "sum_data_flag",
    ])
  );

  let seq = 0;
  for (const row of projwbs) {
    seq += 1024;
    const isRoot = row.parent_wbs_id === null || row.parent_wbs_id === "";
    lines.push(
      tabLine([
        "%R",
        row.wbs_id,
        row.proj_id,
        row.parent_wbs_id ?? "",
        row.wbs_name,
        row.wbs_short_name,
        seq,
        xerGuid(`wbs:${row.wbs_id}`),
        "WS_Open",
        isRoot ? "Y" : "N",
        "N",
      ])
    );
  }

  if (tasks.length > 0) {
    lines.push(tabLine(["%T", "TASK"]));
    lines.push(
      tabLine([
        "%F",
        "task_id",
        "proj_id",
        "wbs_id",
        "task_code",
        "task_name",
        "status_code",
        "task_type",
        "duration_type",
        "clndr_id",
        "phys_complete_pct",
        "rev_fdbk_flag",
      ])
    );
    for (const t of tasks) {
      const a = activityById.get(t.task_id);
      lines.push(
        tabLine([
          "%R",
          t.task_id,
          projId,
          t.wbs_id,
          a?.activityCode ?? t.task_id.slice(0, 8),
          a?.name ?? "Activity",
          "TK_NotStart",
          "TT_Task",
          "DT_FixedDrtn",
          "",
          "0",
          "N",
        ])
      );
    }
  }

  lines.push("%E");
  return lines.join("\n") + "\n";
}
