import "dotenv/config";
import * as XLSX from "xlsx";
import { runWithAuthContextAsync } from "../src/utils/requestContext.js";
import { prisma } from "../src/utils/prisma.js";
import { generateWbsFromFragnets } from "../src/services/wbsFromFragnets.service.js";
import { generateStandardXlsx } from "../src/services/export.service.js";
import { generateHumanReadableWBS } from "../src/services/wbsHumanReadable.service.js";

type TaskRow = {
  activity_id: string;
  activity_name: string;
  wbs_code: string;
  wbs_name: string;
};

type WbsInfo = { name: string; parent: string | null };

function parentCodeOf(code: string): string | null {
  const parts = String(code ?? "").split(".");
  if (parts.length <= 1) return null;
  return parts.slice(0, -1).join(".");
}

function isNumericOnly(s: string): boolean {
  return /^\d+$/.test(String(s ?? "").trim());
}

function pathFor(code: string, wbsMap: Map<string, WbsInfo>): string[] {
  const path: string[] = [];
  let cur: string | null = code;
  const seen = new Set<string>();
  while (cur) {
    if (seen.has(cur)) break;
    seen.add(cur);
    path.push(cur);
    cur = wbsMap.get(cur)?.parent ?? null;
  }
  return path.reverse();
}

async function main(): Promise<void> {
  const companyId = process.env.VALIDATE_COMPANY_ID ?? "cmo8dvlc10000syx0861h1zr5";
  const userId = process.env.VALIDATE_USER_ID ?? "f8dcd529-35e4-4d83-958f-bda119a4887a";
  const standardId = process.env.VALIDATE_STANDARD_ID ?? "100ca17e-edda-4b86-8b62-d1b56d8e0efc";
  const projectCode = process.env.VALIDATE_PROJECT_CODE ?? "testing2";

  const report = await runWithAuthContextAsync({ companyId, userId }, async () => {
    const standard = await prisma.standard.findFirst({
      where: { id: standardId },
      include: {
        fragnets: {
          where: { companyId },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          include: {
            activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
            relationships: true,
            deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
          },
        },
      },
    });
    if (!standard) throw new Error("standard not found");

    const wbs = await generateWbsFromFragnets(standardId);
    const fragnetsForExport = standard.fragnets.map((f) => ({
      id: f.id,
      deliverables: f.deliverables.map((d) => ({
        id: d.id,
        name: d.name,
        bestDuration: d.bestDuration,
        likelyDuration: d.likelyDuration,
        createdAt: d.createdAt,
        assignedResources: [],
      })),
      activities: f.activities.map((a) => ({
        id: a.id,
        deliverableId: a.deliverableId,
        name: a.name,
        bestDuration: a.bestDuration,
        likelyDuration: a.likelyDuration,
        createdAt: a.createdAt,
        assignedResources: [],
      })),
      relationships: f.relationships.map((r) => ({
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
    }));

    const { buffer: xlsxBuf } = await generateStandardXlsx(wbs, fragnetsForExport, "best", "PID", projectCode, []);
    const wb = XLSX.read(xlsxBuf, { type: "buffer" });
    const taskSheet = wb.Sheets["TASK"];
    if (!taskSheet) throw new Error("missing TASK sheet");
    const taskRows = XLSX.utils.sheet_to_json(taskSheet, { header: 1, raw: false }) as any[][];
    const taskHeader = taskRows[1] ?? [];
    const idx = (name: string) => taskHeader.findIndex((x: any) => String(x).trim() === name);
    const idIdx = idx("Activity ID");
    const nameIdx = idx("Activity Name");
    const wbsCodeIdx = idx("WBS Code");
    const wbsNameIdx = idx("WBS Name");

    const tasks: TaskRow[] = taskRows
      .slice(2)
      .map((r) => ({
        activity_id: String(r?.[idIdx] ?? ""),
        activity_name: String(r?.[nameIdx] ?? ""),
        wbs_code: String(r?.[wbsCodeIdx] ?? ""),
        wbs_name: String(r?.[wbsNameIdx] ?? ""),
      }))
      .filter((t) => t.activity_id || t.activity_name || t.wbs_code || t.wbs_name);

    // Build WBS review sheet from same code path as export zip.
    const wbsRows = generateHumanReadableWBS(wbs, projectCode).map((r) => ({
      wbs_code: r.wbs_short_name,
      wbs_name: r.wbs_name,
    }));

    // STEP 1 — Build hierarchy map (and detect duplicates)
    const wbsMap = new Map<string, WbsInfo>();
    const dupCodes: string[] = [];
    for (const r of wbsRows) {
      const code = String(r.wbs_code ?? "");
      const name = String(r.wbs_name ?? "");
      if (!code) continue;
      if (wbsMap.has(code)) dupCodes.push(code);
      wbsMap.set(code, { name, parent: parentCodeOf(code) });
    }
    const codes = [...wbsMap.keys()];
    const wbsSet = new Set(codes);

    // STEP 2 — Validate hierarchy integrity
    const rootExists = wbsMap.has(projectCode);
    const missingParents: { code: string; expectedParent: string | null }[] = [];
    const missingIntermediates: { code: string; missing: string }[] = [];
    for (const code of codes) {
      if (code === projectCode) continue;
      const p = wbsMap.get(code)?.parent ?? null;
      if (!p || !wbsSet.has(p)) missingParents.push({ code, expectedParent: p });
      const parts = code.split(".");
      for (let k = 1; k < parts.length; k++) {
        const prefix = parts.slice(0, k).join(".");
        if (!wbsSet.has(prefix)) {
          missingIntermediates.push({ code, missing: prefix });
          break;
        }
      }
    }

    // STEP 3 — Validate TASK assignments
    const invalidTasks: Array<TaskRow & { reason: string }> = [];
    for (const t of tasks) {
      const code = String(t.wbs_code ?? "");
      if (!code || code.trim() === "") {
        invalidTasks.push({ ...t, reason: "EMPTY_WBS_CODE" });
        continue;
      }
      if (!wbsSet.has(code)) {
        invalidTasks.push({ ...t, reason: "WBS_CODE_NOT_IN_WBS_MAP" });
        continue;
      }
      if (code === projectCode) {
        invalidTasks.push({ ...t, reason: "TASK_ASSIGNED_TO_ROOT" });
        continue;
      }
    }

    // STEP 4 — Validate grouping consistency
    const tasksByWbs = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      const arr = tasksByWbs.get(t.wbs_code) ?? [];
      arr.push(t);
      tasksByWbs.set(t.wbs_code, arr);
    }

    // Heuristic: deliverable header row has activity_name == wbs_name (we set wbs_name to deliverable WBS name for all rows).
    const multiDeliverableWbs: { wbs_code: string; deliverables: string[] }[] = [];
    const wbsWithoutHeader: { wbs_code: string; taskCount: number; sampleTasks: string[] }[] = [];
    for (const [code, arr] of tasksByWbs.entries()) {
      if (code === projectCode) continue;
      const deliverableNames = new Set(arr.filter((x) => x.activity_name && x.activity_name === x.wbs_name).map((x) => x.activity_name));
      if (deliverableNames.size > 1) multiDeliverableWbs.push({ wbs_code: code, deliverables: [...deliverableNames] });
      if (deliverableNames.size === 0) {
        wbsWithoutHeader.push({
          wbs_code: code,
          taskCount: arr.length,
          sampleTasks: arr.slice(0, 8).map((t) => t.activity_name),
        });
      }
    }

    // STEP 6 — Detect P6 failure risks
    const risks: any[] = [];
    const nonPrefixedWbs = codes.filter((c) => !c.startsWith(projectCode));
    if (nonPrefixedWbs.length) risks.push({ code: "WBS_NOT_PREFIXED", count: nonPrefixedWbs.length, sample: nonPrefixedWbs.slice(0, 10) });
    const numericOnlyWbs = codes.filter((c) => isNumericOnly(c));
    if (numericOnlyWbs.length) risks.push({ code: "WBS_NUMERIC_ONLY", count: numericOnlyWbs.length, sample: numericOnlyWbs.slice(0, 10) });
    const numericOnlyTask = tasks.filter((t) => isNumericOnly(t.wbs_code));
    if (numericOnlyTask.length) risks.push({ code: "TASK_WBS_NUMERIC_ONLY", count: numericOnlyTask.length, sample: numericOnlyTask.slice(0, 5) });
    if (missingIntermediates.length) risks.push({ code: "MISSING_INTERMEDIATE_WBS", count: missingIntermediates.length, sample: missingIntermediates.slice(0, 10) });
    const rootTasks = tasks.filter((t) => t.wbs_code === projectCode);
    if (rootTasks.length) risks.push({ code: "TASKS_AT_ROOT", count: rootTasks.length, sample: rootTasks.slice(0, 5) });
    // Deep codes are expected when aligning to XER PROJWBS (e.g. PROJECT.2.11.12). No max-depth check here.

    const fanout = [...tasksByWbs.entries()]
      .filter(([c]) => c !== projectCode)
      .map(([c, arr]) => ({ wbs_code: c, count: arr.length }))
      .sort((a, b) => b.count - a.count);
    const highFanout = fanout.filter((x) => x.count >= 100);
    if (highFanout.length) risks.push({ code: "HIGH_FANOUT_WBS", count: highFanout.length, sample: highFanout.slice(0, 10) });

    // STEP 5 — Sample 10 WBS nodes (prefer those with tasks)
    const wbsSamples = fanout.slice(0, 10).map((x) => {
      const arr = tasksByWbs.get(x.wbs_code) ?? [];
      return {
        wbs_code: x.wbs_code,
        wbs_name: wbsMap.get(x.wbs_code)?.name ?? "",
        parent_wbs: wbsMap.get(x.wbs_code)?.parent ?? null,
        path: pathFor(x.wbs_code, wbsMap),
        taskCount: arr.length,
        sampleTasks: arr.slice(0, 10).map((t) => t.activity_name),
      };
    });

    const validAssignments = tasks.length - invalidTasks.length;
    const sampleTaskRows = tasks.slice(0, 10).map((t) => ({
      activity_id: t.activity_id,
      activity_name: t.activity_name,
      wbs_code: t.wbs_code,
      wbs_name: wbsMap.get(t.wbs_code)?.name ?? t.wbs_name,
      parent_wbs: wbsMap.get(t.wbs_code)?.parent ?? null,
    }));

    return {
      projectCode,
      totals: { tasks: tasks.length, wbsNodes: codes.length, validAssignments, invalidAssignments: invalidTasks.length },
      wbsIntegrity: {
        rootExists,
        duplicateWbsCodes: dupCodes.length,
        missingParents: missingParents.length,
        missingIntermediates: missingIntermediates.length,
      },
      grouping: {
        wbsGroups: tasksByWbs.size,
        multiDeliverableWbs: multiDeliverableWbs.slice(0, 10),
        wbsWithoutHeader: wbsWithoutHeader.slice(0, 10),
      },
      fanoutTop: fanout.slice(0, 10),
      risks,
      invalidTasks: invalidTasks.slice(0, 25),
      wbsSamples,
      sampleTaskRows,
    };
  });

  console.log(JSON.stringify(report, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

