import * as XLSX from "xlsx";
import type { Activity, Deliverable, Fragnet, Prisma, Standard } from "@prisma/client";
import { prisma } from "../../utils/prisma.js";
import { parseStandardsSheet } from "./standards.parser.js";
import { parseFragnetsSheet } from "./fragnets.parser.js";
import { parseDeliverablesSheet } from "./deliverables.parser.js";
import { parseActivitiesSheet } from "./activities.parser.js";
import { parseRelationshipsSheet } from "./relationships.parser.js";
import {
  applyValidatedAssignmentMaps,
  buildAssignmentsImportContext,
  parseAssignmentsFromImportBuffer,
  processAssignmentsImport,
} from "./assignmentsImport.service.js";
import type { ParsedRelationshipRow } from "./relationships.parser.js";

export type ImportResult = {
  success: true;
  created: { standards: number; fragnets: number; deliverables: number; activities: number; relationships: number };
  assignmentsApplied: number;
};

type ParsedBundle = {
  standards: ReturnType<typeof parseStandardsSheet>;
  fragnets: ReturnType<typeof parseFragnetsSheet>;
  deliverables: ReturnType<typeof parseDeliverablesSheet>;
  activities: ReturnType<typeof parseActivitiesSheet>;
};

function normalize(s: string): string {
  return String(s ?? "").trim().toLowerCase();
}

function getSheetRows(wb: XLSX.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[name];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });
}

function validateRelationships(
  rows: ParsedRelationshipRow[],
  fragnetByName: Map<string, { id: string; name: string }>,
  activityByFragnetAndCode: Map<string, { id: string; fragnetId: string; activityCode: string }>,
  opts?: { preventReverseDuplicates?: boolean }
): {
  toCreate: {
    fragnetId: string;
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: "FS" | "SS" | "FF" | "SF";
    lag: number;
  }[];
} {
  const detectCycle = (
    node: string,
    graph: Map<string, string[]>,
    visited: Set<string>,
    stack: Set<string>
  ): boolean => {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    const neighbors = graph.get(node) || [];
    for (const next of neighbors) {
      if (detectCycle(next, graph, visited, stack)) return true;
    }
    stack.delete(node);
    return false;
  };

  const preventReverse = opts?.preventReverseDuplicates ?? true;
  const dup = new Set<string>();
  const undirected = new Set<string>();

  const toCreate: {
    fragnetId: string;
    predecessorActivityId: string;
    successorActivityId: string;
    relationshipType: "FS" | "SS" | "FF" | "SF";
    lag: number;
  }[] = [];

  for (const r of rows) {
    const excelRow = r.sourceExcelRow ?? "?";
    const fragKey = normalize(r.fragnetName);
    const frag = fragnetByName.get(fragKey);
    if (!frag) {
      throw new Error(`Row ${excelRow}: Fragnet ${JSON.stringify(r.fragnetName)} not found`);
    }

    const predKey = `${fragKey}||${normalize(r.predecessorCode)}`;
    const succKey = `${fragKey}||${normalize(r.successorCode)}`;
    const pred = activityByFragnetAndCode.get(predKey);
    if (!pred) {
      throw new Error(
        `Row ${excelRow}: Activity ${JSON.stringify(r.predecessorCode)} not found in fragnet ${JSON.stringify(frag.name)}`
      );
    }
    const succ = activityByFragnetAndCode.get(succKey);
    if (!succ) {
      throw new Error(
        `Row ${excelRow}: Activity ${JSON.stringify(r.successorCode)} not found in fragnet ${JSON.stringify(frag.name)}`
      );
    }

    // Explicit cross-fragnet guard
    if (pred.fragnetId !== frag.id || succ.fragnetId !== frag.id) {
      throw new Error(`Row ${excelRow}: Cross-fragnet relationships are not allowed (fragnet ${JSON.stringify(frag.name)})`);
    }

    if (pred.id === succ.id) {
      throw new Error(`Row ${excelRow}: Predecessor and successor cannot be the same (${r.predecessorCode})`);
    }

    if (Math.abs(r.lag) > 3650) {
      throw new Error(`Row ${excelRow}: Lag too large (${r.lag})`);
    }

    const edgeKey = `${pred.id}-${succ.id}-${r.relationshipType}`;
    if (dup.has(edgeKey)) {
      throw new Error(
        `Row ${excelRow}: Duplicate relationship ${r.predecessorCode} → ${r.successorCode} (${r.relationshipType})`
      );
    }
    dup.add(edgeKey);

    if (preventReverse) {
      const a = pred.id < succ.id ? pred.id : succ.id;
      const b = pred.id < succ.id ? succ.id : pred.id;
      const undirectedKey = `${a}-${b}`;
      if (undirected.has(undirectedKey)) {
        throw new Error(
          `Row ${excelRow}: Reverse duplicate relationship detected between ${r.predecessorCode} and ${r.successorCode}`
        );
      }
      undirected.add(undirectedKey);
    }

    toCreate.push({
      fragnetId: frag.id,
      predecessorActivityId: pred.id,
      successorActivityId: succ.id,
      relationshipType: r.relationshipType,
      lag: r.lag,
    });
  }

  // Cycle detection (per fragnet) — block circular dependencies like A→B→C→A.
  const fragnetNameById = new Map<string, string>();
  for (const f of fragnetByName.values()) fragnetNameById.set(f.id, f.name);

  const graphByFragnet = new Map<string, Map<string, string[]>>();
  for (const rel of toCreate) {
    if (!graphByFragnet.has(rel.fragnetId)) graphByFragnet.set(rel.fragnetId, new Map<string, string[]>());
    const g = graphByFragnet.get(rel.fragnetId)!;
    if (!g.has(rel.predecessorActivityId)) g.set(rel.predecessorActivityId, []);
    g.get(rel.predecessorActivityId)!.push(rel.successorActivityId);
  }

  for (const [fragnetId, graph] of graphByFragnet) {
    const visited = new Set<string>();
    const stack = new Set<string>();
    for (const node of graph.keys()) {
      if (detectCycle(node, graph, visited, stack)) {
        const fragnetName = fragnetNameById.get(fragnetId) ?? fragnetId;
        throw new Error(`Circular dependency detected in fragnet "${fragnetName}"`);
      }
    }
  }

  return { toCreate };
}

function parseAllSheets(fileBuffer: Buffer): ParsedBundle & { relationshipsRowsCount: number; assignmentsRowsCount: number } {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fileBuffer, { type: "buffer" });
  } catch {
    throw new Error("Import: could not read Excel file");
  }

  const standardsRows = getSheetRows(wb, "Standards");
  const fragnetsRows = getSheetRows(wb, "Fragnets");
  const deliverablesRows = getSheetRows(wb, "Deliverables");
  const activitiesRows = getSheetRows(wb, "Activities");
  const relationshipsRows = getSheetRows(wb, "Relationships");

  const standards = parseStandardsSheet(standardsRows);
  const fragnets = parseFragnetsSheet(fragnetsRows);
  const deliverables = parseDeliverablesSheet(deliverablesRows);
  const activities = parseActivitiesSheet(activitiesRows);
  const relationships = parseRelationshipsSheet(relationshipsRows);

  const assignments = parseAssignmentsFromImportBuffer(fileBuffer);

  console.log("[full-import] Parsed rows:", {
    standards: standards.length,
    fragnets: fragnets.length,
    deliverables: deliverables.length,
    activities: activities.length,
    relationships: relationships.length,
    assignments: assignments.length,
  });

  // Note: we return assignments count only; actual assignment parsing is reused later from the same buffer
  return {
    standards,
    fragnets,
    deliverables,
    activities,
    relationshipsRowsCount: relationships.length,
    assignmentsRowsCount: assignments.length,
  };
}

function validateStructure(bundle: ParsedBundle): void {
  // Standards: required already; no duplicates in file
  const standardSet = new Set<string>();
  for (const s of bundle.standards) {
    const k = normalize(s.standardName);
    if (standardSet.has(k)) {
      throw new Error(
        `Standards sheet row ${s.sourceExcelRow ?? "?"}: duplicate standard_name in file: ${JSON.stringify(s.standardName)}`
      );
    }
    standardSet.add(k);
  }

  // Fragnets: standard must exist; no duplicate fragnet per standard
  const fragSet = new Set<string>();
  for (const f of bundle.fragnets) {
    const sk = normalize(f.standardName);
    if (!standardSet.has(sk)) {
      throw new Error(
        `Fragnets sheet row ${f.sourceExcelRow ?? "?"}: standard_name not found in Standards sheet: ${JSON.stringify(
          f.standardName
        )}`
      );
    }
    const key = `${sk}||${normalize(f.fragnetName)}`;
    if (fragSet.has(key)) {
      throw new Error(
        `Fragnets sheet row ${f.sourceExcelRow ?? "?"}: duplicate fragnet_name for standard ${JSON.stringify(
          f.standardName
        )}: ${JSON.stringify(f.fragnetName)}`
      );
    }
    fragSet.add(key);
  }

  // Deliverables: fragnet must exist; no duplicate deliverable per fragnet
  const fragNameSet = new Set<string>(bundle.fragnets.map((f) => normalize(f.fragnetName)));
  const delSet = new Set<string>();
  for (const d of bundle.deliverables) {
    const fk = normalize(d.fragnetName);
    if (!fragNameSet.has(fk)) {
      throw new Error(
        `Deliverables sheet row ${d.sourceExcelRow ?? "?"}: fragnet_name not found in Fragnets sheet: ${JSON.stringify(
          d.fragnetName
        )}`
      );
    }
    const key = `${fk}||${normalize(d.deliverableName)}`;
    if (delSet.has(key)) {
      throw new Error(
        `Deliverables sheet row ${d.sourceExcelRow ?? "?"}: duplicate deliverable_name for fragnet ${JSON.stringify(
          d.fragnetName
        )}: ${JSON.stringify(d.deliverableName)}`
      );
    }
    delSet.add(key);
  }

  // Activities: activity_code unique per fragnet; deliverable exists; deliverable belongs to fragnet
  const actSet = new Set<string>();
  for (const a of bundle.activities) {
    const fk = normalize(a.fragnetName);
    if (!fragNameSet.has(fk)) {
      throw new Error(
        `Activities sheet row ${a.sourceExcelRow ?? "?"}: fragnet_name not found in Fragnets sheet: ${JSON.stringify(
          a.fragnetName
        )}`
      );
    }
    const dk = `${fk}||${normalize(a.deliverableName)}`;
    if (!delSet.has(dk)) {
      throw new Error(
        `Activities sheet row ${a.sourceExcelRow ?? "?"}: deliverable_name not found for fragnet ${JSON.stringify(
          a.fragnetName
        )}: ${JSON.stringify(a.deliverableName)}`
      );
    }
    const key = `${fk}||${normalize(a.activityCode)}`;
    if (actSet.has(key)) {
      throw new Error(
        `Activities sheet row ${a.sourceExcelRow ?? "?"}: duplicate activity_code for fragnet ${JSON.stringify(
          a.fragnetName
        )}: ${JSON.stringify(a.activityCode)}`
      );
    }
    actSet.add(key);
  }
}

/**
 * Import full Hybrid template.
 * Atomic: all entity creation + assignment updates happen inside one transaction.
 */
export async function importFullTemplate(
  fileBuffer: Buffer,
  projectId: string,
  companyId: string,
  dryRun?: boolean
): Promise<
  | ImportResult
  | {
      success: true;
      counts: { standards: number; fragnets: number; deliverables: number; activities: number; relationships: number; assignments: number };
    }
> {
  const projectIdStr = String(projectId ?? "").trim();
  const companyIdStr = String(companyId ?? "").trim();
  if (!projectIdStr) throw new Error("importFullTemplate: projectId is required");
  if (!companyIdStr) throw new Error("importFullTemplate: companyId is required");

  const parsed = parseAllSheets(fileBuffer);
  const bundle: ParsedBundle = {
    standards: parsed.standards,
    fragnets: parsed.fragnets,
    deliverables: parsed.deliverables,
    activities: parsed.activities,
  };

  validateStructure(bundle);

  if (dryRun) {
    // Still validate Assignments against rate card + grouping by using deterministic fake IDs.
    const fakeFragnets: Fragnet[] = bundle.fragnets.map((f, i) => ({
      id: `dry-frag-${i + 1}` as any,
      standardId: `dry-std-${normalize(f.standardName)}` as any,
      name: f.fragnetName,
      description: f.description ?? null,
      createdAt: new Date(),
      projectId: projectIdStr,
      companyId: companyIdStr,
    }));

    const fakeDeliverables: Deliverable[] = bundle.deliverables.map((d, i) => ({
      id: `dry-del-${i + 1}` as any,
      name: d.deliverableName,
      bestDuration: d.bestDuration,
      likelyDuration: d.likelyDuration,
      createdAt: new Date(),
      fragnetId: fakeFragnets.find((f) => normalize(f.name) === normalize(d.fragnetName))?.id ?? null,
      assignedResources: [] as any,
      projectId: projectIdStr,
      externalProjectId: d.externalProjectId ?? null,
      companyId: companyIdStr,
    }));

    const delByFragName = new Map<string, Deliverable[]>();
    for (const d of fakeDeliverables) {
      const frag = fakeFragnets.find((f) => f.id === d.fragnetId);
      const k = frag ? frag.name.trim() : "";
      if (!k) continue;
      const arr = delByFragName.get(k) ?? [];
      arr.push(d);
      delByFragName.set(k, arr);
    }

    const fakeActivities: (Activity & { deliverable: Deliverable })[] = bundle.activities.map((a, i) => {
      const frag = fakeFragnets.find((f) => normalize(f.name) === normalize(a.fragnetName))!;
      const del = fakeDeliverables.find(
        (d) => d.fragnetId === frag.id && normalize(d.name) === normalize(a.deliverableName)
      )!;
      return {
        id: `dry-act-${i + 1}` as any,
        fragnetId: frag.id,
        activityCode: a.activityCode,
        name: a.activityName,
        status: a.status as any,
        bestDuration: a.bestDuration,
        likelyDuration: a.likelyDuration,
        assuranceNoteId: null,
        createdAt: new Date(),
        assignedResources: [] as any,
        deliverableId: del.id,
        projectId: projectIdStr,
        companyId: companyIdStr,
        deliverable: del,
      } as any;
    });

    const assignmentsRows = parseAssignmentsFromImportBuffer(fileBuffer);
    const ctx = buildAssignmentsImportContext({
      fragnets: fakeFragnets,
      deliverables: fakeDeliverables,
      activities: fakeActivities,
    });
    await processAssignmentsImport({ companyId: companyIdStr, parsedRows: assignmentsRows, context: ctx });

    // Validate relationships sheet as well (no DB writes)
    const relRows = parseRelationshipsSheet(getSheetRows(XLSX.read(fileBuffer, { type: "buffer" }), "Relationships"));
    if (relRows.length > 0) {
      const fragnetByName = new Map(fakeFragnets.map((f) => [normalize(f.name), { id: f.id, name: f.name }]));
      const activityByFragnetAndCode = new Map<string, { id: string; fragnetId: string; activityCode: string }>();
      for (const a of fakeActivities) {
        const frag = fakeFragnets.find((f) => f.id === a.fragnetId)!;
        activityByFragnetAndCode.set(`${normalize(frag.name)}||${normalize(a.activityCode)}`, {
          id: String(a.id),
          fragnetId: String(a.fragnetId),
          activityCode: a.activityCode,
        });
      }
      validateRelationships(relRows, fragnetByName, activityByFragnetAndCode);
    }

    return {
      success: true,
      counts: {
        standards: bundle.standards.length,
        fragnets: bundle.fragnets.length,
        deliverables: bundle.deliverables.length,
        activities: bundle.activities.length,
        relationships: parsed.relationshipsRowsCount,
        assignments: parsed.assignmentsRowsCount,
      },
    };
  }

  const result = await prisma.$transaction(
    async (tx) => {
    // Create standards
    const standardByName = new Map<string, Standard>();
    for (const s of bundle.standards) {
      const created = await tx.standard.create({
        data: {
          name: s.standardName.trim(),
          description: s.description != null && String(s.description).trim() !== "" ? String(s.description) : null,
          projectId: projectIdStr,
          companyId: companyIdStr,
        },
      });
      standardByName.set(normalize(created.name), created);
    }

    // Create fragnets
    const fragnetByStdAndName = new Map<string, Fragnet>();
    for (const f of bundle.fragnets) {
      const std = standardByName.get(normalize(f.standardName));
      if (!std) {
        throw new Error(`Import: missing standard for fragnet ${JSON.stringify(f.fragnetName)}: ${JSON.stringify(f.standardName)}`);
      }
      const created = await tx.fragnet.create({
        data: {
          standardId: std.id,
          name: f.fragnetName.trim(),
          description: f.description != null && String(f.description).trim() !== "" ? String(f.description) : null,
          projectId: projectIdStr,
          companyId: companyIdStr,
        },
      });
      fragnetByStdAndName.set(`${normalize(f.standardName)}||${normalize(created.name)}`, created);
    }

    // Create deliverables
    const fragnetByName = new Map<string, Fragnet>();
    for (const [, fr] of fragnetByStdAndName) {
      fragnetByName.set(normalize(fr.name), fr);
    }

    const deliverableByFragAndName = new Map<string, Deliverable>();
    for (const d of bundle.deliverables) {
      const frag = fragnetByName.get(normalize(d.fragnetName));
      if (!frag) {
        throw new Error(`Import: missing fragnet for deliverable ${JSON.stringify(d.deliverableName)}: ${JSON.stringify(d.fragnetName)}`);
      }
      const created = await tx.deliverable.create({
        data: {
          name: d.deliverableName.trim(),
          bestDuration: d.bestDuration,
          likelyDuration: d.likelyDuration,
          fragnetId: frag.id,
          assignedResources: [] as any,
          projectId: projectIdStr,
          externalProjectId: d.externalProjectId != null && String(d.externalProjectId).trim() !== "" ? String(d.externalProjectId).trim() : null,
          companyId: companyIdStr,
        } as Prisma.DeliverableUncheckedCreateInput,
      });
      deliverableByFragAndName.set(`${normalize(frag.name)}||${normalize(created.name)}`, created);
    }

    const { materializeTemplatesForDeliverable } = await import("../fragnetActivityTemplate.service.js");
    for (const del of deliverableByFragAndName.values()) {
      await materializeTemplatesForDeliverable(del.id, companyIdStr);
    }

    // Create activities
    const activitiesCreated: (Activity & { deliverable: Deliverable })[] = [];
    for (const a of bundle.activities) {
      const frag = fragnetByName.get(normalize(a.fragnetName));
      if (!frag) {
        throw new Error(`Import: missing fragnet for activity ${JSON.stringify(a.activityCode)}: ${JSON.stringify(a.fragnetName)}`);
      }
      const del = deliverableByFragAndName.get(`${normalize(frag.name)}||${normalize(a.deliverableName)}`);
      if (!del) {
        throw new Error(
          `Import: missing deliverable for activity ${JSON.stringify(a.activityCode)} under fragnet ${JSON.stringify(frag.name)}: ${JSON.stringify(
            a.deliverableName
          )}`
        );
      }

      const created = await tx.activity.create({
        data: {
          fragnetId: frag.id,
          deliverableId: del.id,
          activityCode: a.activityCode.trim(),
          name: a.activityName.trim(),
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          status: a.status as any,
          assuranceNoteId: null,
          assignedResources: [] as any,
          projectId: projectIdStr,
          companyId: companyIdStr,
        },
      });
      activitiesCreated.push({ ...(created as any), deliverable: del });
    }

    // Relationships (after activities, before assignments)
    const relParsed = parseRelationshipsSheet(getSheetRows(XLSX.read(fileBuffer, { type: "buffer" }), "Relationships"));
    let relationshipsCreated = 0;
    if (relParsed.length > 0) {
      const fragnetLookup = new Map<string, { id: string; name: string }>();
      for (const fr of fragnetByName.values()) {
        fragnetLookup.set(normalize(fr.name), { id: fr.id, name: fr.name });
      }
      const activityLookup = new Map<string, { id: string; fragnetId: string; activityCode: string }>();
      const fragNameById = new Map<string, string>();
      for (const fr of fragnetByName.values()) fragNameById.set(fr.id, fr.name);
      for (const a of activitiesCreated) {
        // We key by fragnet name (from map) + activity_code (unique per fragnet)
        const fragName = fragNameById.get(a.fragnetId) ?? "";
        activityLookup.set(`${normalize(fragName)}||${normalize(a.activityCode)}`, {
          id: a.id,
          fragnetId: a.fragnetId,
          activityCode: a.activityCode,
        });
      }

      const { toCreate } = validateRelationships(relParsed, fragnetLookup, activityLookup);
      const createData = toCreate.map((r) => ({
        fragnetId: r.fragnetId,
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
        projectId: projectIdStr,
        companyId: companyIdStr,
      }));
      const created = await tx.relationship.createMany({ data: createData });
      relationshipsCreated = created.count;
    }

    // Apply assignments (if any)
    const parsedAssignments = parseAssignmentsFromImportBuffer(fileBuffer);
    let assignmentsApplied = 0;
    if (parsedAssignments.length > 0) {
      const ctx = buildAssignmentsImportContext({
        fragnets: [...fragnetByName.values()],
        deliverables: [...deliverableByFragAndName.values()],
        activities: activitiesCreated,
      });
      const processed = await processAssignmentsImport({ companyId: companyIdStr, parsedRows: parsedAssignments, context: ctx });
      const applied = await applyValidatedAssignmentMaps(tx, processed, {
        companyId: companyIdStr,
        deliverableIds: [...processed.byDeliverableId.keys()],
        activityIds: [...processed.byActivityId.keys()],
      });
      assignmentsApplied = applied.deliverablesUpdated + applied.activitiesUpdated;
    }

    return {
      success: true as const,
      created: {
        standards: bundle.standards.length,
        fragnets: bundle.fragnets.length,
        deliverables: bundle.deliverables.length,
        activities: bundle.activities.length,
        relationships: relationshipsCreated,
      },
      assignmentsApplied,
    };
    },
    // Large imports can exceed Prisma's default interactive transaction timeout.
    { maxWait: 30_000, timeout: 10 * 60_000 }
  );

  console.log("[full-import] Created:", result.created, "assignmentsApplied:", result.assignmentsApplied);
  return result;
}

