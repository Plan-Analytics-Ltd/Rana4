import { createHash } from "node:crypto";import { generateWBS } from "./wbsGenerate.service.js";
import { validateGeneratedWbsForP6Export, validateGeneratedWbsStructure } from "./wbsExportValidation.service.js";
import { mapToXER } from "./xerWbsMap.service.js";
import { generateWbsFromFragnets } from "./wbsFromFragnets.service.js";

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
 * Build a tab-delimited Primavera-style XER fragment: ERMHDR + PROJWBS only (WBS shell).
 * TASK / relationships / activity codes on activities are exported via spreadsheet, not XER.
 * Calls {@link generateWBS} then {@link mapToXER}. Does not write to disk.
 */
export type ExportMode = "FRAGNET" | "STANDARD";

export async function generateXERFile(params: {
  mode: ExportMode;
  projectId?: string;
  standardId?: string;
}): Promise<string> {
  const { mode } = params;
  const wbs =
    mode === "FRAGNET"
      ? await generateWBS(String(params.projectId ?? "").trim())
      : await generateWbsFromFragnets(String(params.standardId ?? "").trim());
  const structureIssues = validateGeneratedWbsStructure(wbs);
  if (structureIssues.length > 0) {
    throw new Error(
      `WBS structure validation failed: ${structureIssues.map((i) => i.message).join("; ")}`
    );
  }
  const p6Issues = validateGeneratedWbsForP6Export(wbs);
  if (p6Issues.length > 0) {
    throw new Error(`WBS invalid for P6/XER: ${p6Issues.map((i) => i.message).join("; ")}`);
  }
  const mapped = mapToXER(wbs);
  const { projwbs } = mapped;

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

  lines.push("%E");
  return lines.join("\n") + "\n";
}
