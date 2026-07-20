import { parseXerProgramme, parseXerTables } from "../intelligence/shared/xerParse.service.js";
import {
  extractProgrammeNameSourcesFromTables,
  resolveCanonicalProgrammeName,
} from "../intelligence/shared/programmeIdentity.service.js";
import type { ImportedActivityRow, ImportedRelationshipRow } from "../intelligence/shared/types.js";
import { detectProjectFromXer, type ProjectDetectionResult } from "./projectDetection.service.js";

export type XerValidationIssue = {
  severity: "error" | "warning";
  message: string;
};

export type XerPreviewResult = {
  valid: boolean;
  errors: XerValidationIssue[];
  warnings: XerValidationIssue[];
  projectName: string;
  programmeName: string;
  primaveraProjectId: string | null;
  wbsCount: number;
  activityCount: number;
  relationshipCount: number;
  calendarCount: number;
  resourceCount: number;
  projectStart: string | null;
  projectFinish: string | null;
  suggestedProjectName: string;
  duplicateProjectName: boolean;
  detection: ProjectDetectionResult | null;
};

export type PlannedActivity = ImportedActivityRow & {
  fragnetName: string;
  deliverableName: string;
};

export type XerEntityPlan = {
  standardName: string;
  fragnets: {
    name: string;
    deliverables: {
      name: string;
      activities: PlannedActivity[];
    }[];
  }[];
  relationships: ImportedRelationshipRow[];
  scheduleStartDate?: Date;
  parsed: ReturnType<typeof parseXerProgramme>;
};

type WbsNode = { id: string; parentId: string | null; name: string };

function parseP6Date(value: string | undefined): Date | undefined {
  const v = String(value ?? "").trim();
  if (!v) return undefined;
  const d = new Date(v.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function isoDate(d: Date | undefined): string | null {
  if (!d) return null;
  return d.toISOString().slice(0, 10);
}

// RANA planning duration seeded from the imported original (target) duration.
// Remaining Duration is still parsed/stored elsewhere but does not populate Best/Likely.
function durationDays(row: ImportedActivityRow): number {
  const d =
    row.originalDurationDays ??
    row.actualDurationDays ??
    1;
  return Math.max(1, Math.round(d));
}

function findRootId(nodes: Map<string, WbsNode>): string | null {
  for (const [id, n] of nodes) {
    const p = n.parentId;
    if (!p || p === "0" || p === id) return id;
  }
  if (nodes.has("1")) return "1";
  return nodes.size > 0 ? [...nodes.keys()][0]! : null;
}

function fragnetNameForWbs(wbsId: string, nodes: Map<string, WbsNode>, rootId: string): string {
  let current = wbsId;
  while (current && current !== rootId) {
    const node = nodes.get(current);
    if (!node) break;
    if (node.parentId === rootId) return node.name;
    current = node.parentId ?? "";
  }
  const leaf = nodes.get(wbsId);
  return leaf?.name ?? "Imported Programme";
}

function deliverableNameForWbs(wbsId: string, nodes: Map<string, WbsNode>, rootId: string): string {
  const node = nodes.get(wbsId);
  if (!node) return `WBS ${wbsId}`;
  if (node.parentId === rootId) return `${node.name} -- Work package`;
  return node.name;
}

function buildWbsNodes(tables: ReturnType<typeof parseXerTables>): Map<string, WbsNode> {
  const wbsTable = tables.get("PROJWBS");
  const nodes = new Map<string, WbsNode>();
  if (!wbsTable) return nodes;

  for (const r of wbsTable.rows) {
    const id = String(r.wbs_id ?? "").trim();
    if (!id) continue;
    const parentRaw = String(r.parent_wbs_id ?? "").trim();
    nodes.set(id, {
      id,
      parentId: parentRaw && parentRaw !== id ? parentRaw : null,
      name: String(r.wbs_name ?? r.wbs_short_name ?? `WBS ${id}`).trim() || `WBS ${id}`,
    });
  }
  return nodes;
}

function taskWbsByCode(tables: ReturnType<typeof parseXerTables>): Map<string, string> {
  const taskTable = tables.get("TASK");
  const out = new Map<string, string>();
  if (!taskTable) return out;
  for (const r of taskTable.rows) {
    const code = String(r.task_code ?? "").trim().toUpperCase();
    const wbsId = String(r.wbs_id ?? "").trim();
    if (code && wbsId) out.set(code, wbsId);
  }
  return out;
}

export function validateXerBuffer(buffer: Buffer, fileName: string): XerValidationIssue[] {
  const issues: XerValidationIssue[] = [];
  const lower = fileName.toLowerCase();
  if (!lower.endsWith(".xer")) {
    issues.push({ severity: "error", message: "File must be a Primavera .xer export." });
  }

  const head = buffer.slice(0, 400).toString("utf8");
  if (!head.includes("%T") && !head.startsWith("ERMHDR")) {
    issues.push({
      severity: "error",
      message: "This does not look like a valid Primavera XER file. Export from P6 and try again.",
    });
    return issues;
  }

  let tables: ReturnType<typeof parseXerTables>;
  try {
    tables = parseXerTables(buffer.toString("utf8"));
  } catch {
    issues.push({ severity: "error", message: "Could not read the XER file — it may be corrupt." });
    return issues;
  }

  const taskTable = tables.get("TASK");
  if (!taskTable?.rows.length) {
    issues.push({ severity: "error", message: "No activities were found in this XER file." });
  }

  const calendarTable = tables.get("CALENDAR");
  if (!calendarTable?.rows.length) {
    issues.push({
      severity: "warning",
      message: "No calendars were found. Schedule dates may be less accurate until calendars are configured.",
    });
  }

  if (taskTable) {
    const codes = new Set<string>();
    for (const r of taskTable.rows) {
      const code = String(r.task_code ?? "").trim().toUpperCase();
      if (!code) {
        issues.push({ severity: "warning", message: "Some activities are missing activity codes and will be skipped." });
        continue;
      }
      if (codes.has(code)) {
        issues.push({ severity: "error", message: `Duplicate activity code in XER: ${code}` });
      }
      codes.add(code);
    }
  }

  const predTable = tables.get("TASKPRED");
  if (predTable && taskTable) {
    const taskIds = new Set(taskTable.rows.map((r) => String(r.task_id ?? "").trim()).filter(Boolean));
    for (const p of predTable.rows) {
      const tid = String(p.task_id ?? "").trim();
      const pid = String(p.pred_task_id ?? "").trim();
      if (tid && !taskIds.has(tid)) {
        issues.push({ severity: "warning", message: "Some relationships reference missing activities and will be skipped." });
        break;
      }
      if (pid && !taskIds.has(pid)) {
        issues.push({ severity: "warning", message: "Some relationships reference missing predecessor activities and will be skipped." });
        break;
      }
    }
  }

  return issues;
}

export function buildXerPreview(
  buffer: Buffer,
  fileName: string,
  opts?: { existingProjectNames?: string[] }
): XerPreviewResult {
  const validation = validateXerBuffer(buffer, fileName);
  const errors = validation.filter((v) => v.severity === "error");
  const warnings = validation.filter((v) => v.severity === "warning");

  if (errors.length > 0) {
    return {
      valid: false,
      errors,
      warnings,
      projectName: "",
      programmeName: "",
      primaveraProjectId: null,
      wbsCount: 0,
      activityCount: 0,
      relationshipCount: 0,
      calendarCount: 0,
      resourceCount: 0,
      projectStart: null,
      projectFinish: null,
      suggestedProjectName: "",
      duplicateProjectName: false,
      detection: null,
    };
  }

  const text = buffer.toString("utf8");
  const tables = parseXerTables(text);
  const parsed = parseXerProgramme(buffer);

  const projectRow = tables.get("PROJECT")?.rows[0];
  const nameSources = extractProgrammeNameSourcesFromTables(tables, fileName);
  const canonicalProgrammeName = resolveCanonicalProgrammeName(nameSources);
  const programmeName =
    canonicalProgrammeName ||
    String(projectRow?.proj_short_name ?? projectRow?.proj_id ?? "").trim();
  const projectName = String(projectRow?.proj_short_name ?? projectRow?.wbs_name ?? programmeName).trim();
  const primaveraProjectId = projectRow?.proj_id ? String(projectRow.proj_id).trim() : null;

  const wbsCount = tables.get("PROJWBS")?.rows.length ?? 0;
  const calendarCount = tables.get("CALENDAR")?.rows.length ?? 0;
  const resourceCount = tables.get("RSRC")?.rows.length ?? 0;

  const projectStart = isoDate(
    parseP6Date(projectRow?.plan_start_date ?? projectRow?.scd_start_date ?? projectRow?.last_schedule_date)
  );
  const projectFinish = isoDate(parseP6Date(projectRow?.plan_end_date ?? projectRow?.scd_end_date));

  const detection = detectProjectFromXer({
    buffer,
    fileName,
    activityCount: parsed.activities.length,
    relationshipCount: parsed.relationships.length,
    wbsCount,
    calendarCount,
    resourceCount,
  });

  const detectedName = detection.projectName.value?.trim();
  const suggestedProjectName = (
    detectedName ||
    projectName ||
    programmeName ||
    fileName.replace(/\.xer$/i, "")
  ).slice(0, 255);
  const duplicateProjectName = (opts?.existingProjectNames ?? []).some(
    (n) => n.trim().toLowerCase() === suggestedProjectName.toLowerCase()
  );

  if (duplicateProjectName) {
    warnings.push({
      severity: "warning",
      message: `A project named "${suggestedProjectName}" already exists. Choose a different name before importing.`,
    });
  }

  return {
    valid: true,
    errors,
    warnings,
    projectName: projectName || suggestedProjectName,
    programmeName: programmeName || projectName || suggestedProjectName,
    primaveraProjectId,
    wbsCount,
    activityCount: parsed.activities.length,
    relationshipCount: parsed.relationships.length,
    calendarCount,
    resourceCount,
    projectStart,
    projectFinish,
    suggestedProjectName,
    duplicateProjectName,
    detection,
  };
}

export function buildXerEntityPlan(buffer: Buffer, fileName: string): XerEntityPlan {
  const validation = validateXerBuffer(buffer, fileName);
  const errors = validation.filter((v) => v.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((e) => e.message).join(" "));
  }

  const text = buffer.toString("utf8");
  const tables = parseXerTables(text);
  const parsed = parseXerProgramme(buffer);
  const wbsNodes = buildWbsNodes(tables);
  const taskWbs = taskWbsByCode(tables);
  const rootId = findRootId(wbsNodes);

  const fragnetMap = new Map<string, Map<string, PlannedActivity[]>>();

  const assignActivity = (fragnetName: string, deliverableName: string, activity: PlannedActivity) => {
    if (!fragnetMap.has(fragnetName)) fragnetMap.set(fragnetName, new Map());
    const delMap = fragnetMap.get(fragnetName)!;
    if (!delMap.has(deliverableName)) delMap.set(deliverableName, []);
    delMap.get(deliverableName)!.push(activity);
  };

  for (const row of parsed.activities) {
    const codeKey = row.activityCode.trim().toUpperCase();
    const wbsId = taskWbs.get(codeKey);
    let fragnetName = "Imported Programme";
    let deliverableName = "Programme";

    if (wbsId && wbsNodes.size > 0 && rootId) {
      fragnetName = fragnetNameForWbs(wbsId, wbsNodes, rootId);
      deliverableName = deliverableNameForWbs(wbsId, wbsNodes, rootId);
    } else if (wbsNodes.size > 0 && rootId) {
      fragnetName = "Imported Programme";
      deliverableName = "Programme";
    }

    assignActivity(fragnetName, deliverableName, {
      ...row,
      fragnetName,
      deliverableName,
    });
  }

  if (fragnetMap.size === 0) {
    fragnetMap.set("Imported Programme", new Map([["Programme", []]]));
  }

  const projectRow = tables.get("PROJECT")?.rows[0];
  const nameSources = extractProgrammeNameSourcesFromTables(tables, fileName);
  const canonicalProgrammeName = resolveCanonicalProgrammeName(nameSources);
  const standardName =
    canonicalProgrammeName ||
    String(projectRow?.proj_short_name ?? "Primavera Import").trim() ||
    "Primavera Import";

  const fragnets = [...fragnetMap.entries()].map(([fragnetName, delMap]) => ({
    name: fragnetName,
    deliverables: [...delMap.entries()].map(([deliverableName, activities]) => ({
      name: deliverableName,
      activities,
    })),
  }));

  return {
    standardName,
    fragnets,
    relationships: parsed.relationships,
    scheduleStartDate: parsed.scheduleDate,
    parsed,
  };
}

export function deliverableDurationFromActivities(activities: PlannedActivity[]): {
  bestDuration: number;
  likelyDuration: number;
} {
  let max = 1;
  for (const a of activities) {
    max = Math.max(max, durationDays(a));
  }
  return { bestDuration: max, likelyDuration: max };
}
