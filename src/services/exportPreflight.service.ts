import type { Relationship } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { assignmentsFromDb, getRateCardEntries } from "./rateCard.js";
import type { DeliverableWithActivities } from "./deliverableActivityLink.service.js";
import { buildWbsForFragnetExport } from "./wbsGenerate.service.js";
import {
  validateFragnetForWbsExport,
  validateGeneratedWbsForP6Export,
  validateGeneratedWbsStructure,
} from "./wbsExportValidation.service.js";
import {
  generateFragnetXlsx,
  generateStandardXlsx,
  type ExportScenario,
  type StandardFragnetForExport,
} from "./export.service.js";
import { loadActivityCodeCatalogForExport } from "./activityCodeCatalog.service.js";
import { generateXERWithWBS } from "./xerTemplateInject.service.js";
import { generateWbsFromFragnets } from "./wbsFromFragnets.service.js";
import { buildUnassignedFragnetForExport } from "./exportUnassignedDeliverables.service.js";
import { repairDeliverableFragnetIdsForProject } from "./deliverableActivityChain.service.js";
import {
  collectActivityAssignmentIssues,
  type ActivityAssignmentValidationResult,
} from "./activityAssignmentValidation.service.js";
import {
  assertActivityCodeCatalogConsistency,
  assertAssignedResourcesExistOnRateCard,
  assertUniqueWbsPathsForSpreadsheet,
} from "./p6SpreadsheetExportValidation.service.js";
import { collectXerValidationIssues } from "./p6XerExportValidation.service.js";

export type ExportPreflightIssue = {
  phase:
    | "wbs_fragnet"
    | "assignments"
    | "wbs_structure"
    | "p6_spreadsheet"
    | "xlsx"
    | "xer_build"
    | "xer_validation";
  severity: "error" | "warning";
  code: string;
  message: string;
  fragnetId?: string;
};

export type ExportPreflightResult = {
  ok: boolean;
  issues: ExportPreflightIssue[];
  assignment?: ActivityAssignmentValidationResult;
  errorCount: number;
  warningCount: number;
};

function pushIssue(
  issues: ExportPreflightIssue[],
  issue: Omit<ExportPreflightIssue, "severity"> & { severity?: ExportPreflightIssue["severity"] }
): void {
  issues.push({ severity: issue.severity ?? "error", ...issue });
}

function projectCodeFromIds(projectId: string, projectName: string): string {
  const pid = String(projectId).trim();
  const pname = String(projectName).trim();
  return pid !== "" && pname !== "" && pid === `${pname}1` ? pname : pid;
}

export async function runStandardExportPreflight(args: {
  companyId: string;
  standardId: string;
  scenario: ExportScenario;
  projectId: string;
  projectName: string;
}): Promise<ExportPreflightResult> {
  const issues: ExportPreflightIssue[] = [];
  const { companyId, standardId, scenario, projectId, projectName } = args;

  const { materializeProjectDeliverablesInOrder } = await import("./fragnetActivityTemplate.service.js");
  const standard = await prisma.standard.findFirst({
    where: { id: standardId, companyId },
    include: {
      fragnets: {
        where: { companyId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
          relationships: true,
          deliverableRelationships: true,
          deliverableActivityRelationships: true,
          deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!standard) throw new Error("Standard not found");

  await materializeProjectDeliverablesInOrder(standard.projectId, companyId);
  await repairDeliverableFragnetIdsForProject(standard.projectId, companyId);

  const standardReloaded = await prisma.standard.findFirst({
    where: { id: standardId, companyId },
    include: {
      fragnets: {
        where: { companyId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: {
          activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
          relationships: true,
          deliverableRelationships: true,
          deliverableActivityRelationships: true,
          deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!standardReloaded) throw new Error("Standard not found");

  for (const fragnet of standardReloaded.fragnets) {
    for (const w of validateFragnetForWbsExport(fragnet)) {
      pushIssue(issues, {
        phase: "wbs_fragnet",
        code: w.code ?? "WBS_FRAGNET",
        message: w.message,
        fragnetId: fragnet.id,
      });
    }
  }

  const { result: assignment, issues: assignmentIssues } = collectActivityAssignmentIssues(standardReloaded);
  for (const a of assignmentIssues) {
    pushIssue(issues, { phase: "assignments", code: a.code, message: a.message });
  }

  let generatedWbs;
  try {
    generatedWbs = await generateWbsFromFragnets(standardReloaded.id);
  } catch (e) {
    pushIssue(issues, {
      phase: "wbs_structure",
      code: "WBS_GENERATE",
      message: e instanceof Error ? e.message : String(e),
    });
    return summarizePreflight(issues, assignment);
  }

  for (const w of validateGeneratedWbsStructure(generatedWbs)) {
    pushIssue(issues, {
      phase: "wbs_structure",
      code: w.code ?? "WBS_STRUCTURE",
      message: w.message,
      severity: "error",
    });
  }
  for (const w of validateGeneratedWbsForP6Export(generatedWbs)) {
    pushIssue(issues, {
      phase: "wbs_structure",
      code: w.code ?? "WBS_P6",
      message: w.message,
    });
  }

  const rateCardEntries = await getRateCardEntries(companyId);
  const projectCode = projectCodeFromIds(projectId, projectName);
  const pid = String(projectId).trim();
  const pname = String(projectName).trim();
  const p6ProjCell = Number.isFinite(Number(pid)) ? Number(pid) : pid;

  const fragnetsForExport: StandardFragnetForExport[] = await Promise.all(
    standardReloaded.fragnets.map(async (f) => ({
      id: f.id,
      deliverables: await Promise.all(
        f.deliverables.map(async (d) => ({
          id: d.id,
          name: d.name,
          bestDuration: d.bestDuration,
          likelyDuration: d.likelyDuration,
          createdAt: d.createdAt,
          assignedResources: await assignmentsFromDb(companyId, d.assignedResources),
        }))
      ),
      activities: await Promise.all(
        f.activities.map(async (a) => ({
          id: a.id,
          activityCode: a.activityCode,
          deliverableId: a.deliverableId,
          name: a.name,
          bestDuration: a.bestDuration,
          likelyDuration: a.likelyDuration,
          createdAt: a.createdAt,
          assignedResources: await assignmentsFromDb(companyId, a.assignedResources),
        }))
      ),
      relationships: f.relationships.map((r: Relationship) => ({
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      deliverableRelationships: f.deliverableRelationships.map((r) => ({
        predecessorDeliverableId: r.predecessorDeliverableId,
        successorDeliverableId: r.successorDeliverableId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      deliverableActivityRelationships: f.deliverableActivityRelationships.map((r) => ({
        predecessorDeliverableId: r.predecessorDeliverableId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
    }))
  );

  const unassignedFragnet = await buildUnassignedFragnetForExport(standardReloaded.projectId, companyId);
  if (unassignedFragnet) fragnetsForExport.push(unassignedFragnet);

  const allActivityIds = fragnetsForExport.flatMap((f) => f.activities.map((a) => a.id));
  const allDeliverableIds = fragnetsForExport.flatMap((f) => f.deliverables.map((d) => d.id));
  const activityCatalog = await loadActivityCodeCatalogForExport(companyId, {
    activityIds: allActivityIds,
    deliverableIds: allDeliverableIds,
  });

  try {
    assertUniqueWbsPathsForSpreadsheet(generatedWbs, projectCode);
    assertActivityCodeCatalogConsistency(activityCatalog);
    assertAssignedResourcesExistOnRateCard(
      rateCardEntries,
      fragnetsForExport.flatMap((f) => [...f.deliverables, ...f.activities])
    );
  } catch (e) {
    pushIssue(issues, {
      phase: "p6_spreadsheet",
      code: "P6_SPREADSHEET",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  let pendingSemanticRows;
  let taskPredExportRows;
  try {
    const built = await generateStandardXlsx(
      generatedWbs,
      fragnetsForExport,
      scenario,
      pid,
      projectCode,
      rateCardEntries,
      {
        exportContext: {
          companyId,
          ranaProjectId: standardReloaded.projectId,
          p6ProjIdCell: p6ProjCell,
        },
        activityCatalog,
      }
    );
    pendingSemanticRows = built.pendingSemanticRows;
    taskPredExportRows = built.taskPredExportRows;
  } catch (e) {
    pushIssue(issues, {
      phase: "xlsx",
      code: "XLSX_BUILD",
      message: e instanceof Error ? e.message : String(e),
    });
    return summarizePreflight(issues, assignment);
  }

  try {
    const xerString = await generateXERWithWBS(generatedWbs, pname, projectCode, rateCardEntries, {
      activityCatalog,
      pendingSemanticTaskRows: pendingSemanticRows,
      xerDeterministicScope: `${companyId}:${standardReloaded.projectId}:${projectCode}`,
      taskPredExportRows,
      assertValidOnComplete: false,
    });
    for (const x of collectXerValidationIssues(xerString)) {
      pushIssue(issues, {
        phase: "xer_validation",
        code: x.code,
        message: x.message,
      });
    }
  } catch (e) {
    pushIssue(issues, {
      phase: "xer_build",
      code: "XER_BUILD",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return summarizePreflight(issues, assignment);
}

export async function runFragnetExportPreflight(args: {
  companyId: string;
  fragnetId: string;
  scenario: ExportScenario;
  projectId: string;
  projectName: string;
}): Promise<ExportPreflightResult> {
  const issues: ExportPreflightIssue[] = [];
  const { companyId, fragnetId, scenario, projectId, projectName } = args;

  const { materializeTemplatesForAllDeliverables } = await import("./fragnetActivityTemplate.service.js");
  let fragnet = await prisma.fragnet.findFirst({
    where: { id: fragnetId, companyId },
    include: {
      activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
      relationships: true,
      deliverableRelationships: true,
      deliverableActivityRelationships: true,
      deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!fragnet) throw new Error("Fragnet not found");

  await materializeTemplatesForAllDeliverables(fragnetId, companyId);
  await repairDeliverableFragnetIdsForProject(fragnet.projectId, companyId);

  fragnet =
    (await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId },
      include: {
        activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
        relationships: true,
        deliverableRelationships: true,
        deliverableActivityRelationships: true,
        deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
      },
    })) ?? fragnet;

  for (const w of validateFragnetForWbsExport(fragnet)) {
    pushIssue(issues, {
      phase: "wbs_fragnet",
      code: w.code ?? "WBS_FRAGNET",
      message: w.message,
      fragnetId: fragnet.id,
    });
  }

  const deliverablesForExport = await Promise.all(
    fragnet.deliverables.map(async (d) => ({
      id: d.id,
      name: d.name,
      bestDuration: d.bestDuration,
      likelyDuration: d.likelyDuration,
      createdAt: d.createdAt,
      assignedResources: await assignmentsFromDb(companyId, d.assignedResources),
    }))
  );
  const activitiesForExport = await Promise.all(
    fragnet.activities.map(async (a) => ({
      id: a.id,
      activityCode: a.activityCode,
      deliverableId: a.deliverableId,
      name: a.name,
      bestDuration: a.bestDuration,
      likelyDuration: a.likelyDuration,
      createdAt: a.createdAt,
      assignedResources: await assignmentsFromDb(companyId, a.assignedResources),
    }))
  );

  const deliverablesWithActivities: DeliverableWithActivities[] = fragnet.deliverables.map((d) => ({
    ...d,
    activities: fragnet.activities
      .filter((a) => a.deliverableId === d.id)
      .sort((a, b) => {
        const c = a.activityCode.localeCompare(b.activityCode);
        if (c !== 0) return c;
        return a.id.localeCompare(b.id);
      }),
  }));

  const pname = String(projectName).trim();
  const generatedWbs = buildWbsForFragnetExport(pname, { id: fragnet.id, name: fragnet.name }, deliverablesWithActivities);

  for (const w of validateGeneratedWbsStructure(generatedWbs)) {
    pushIssue(issues, {
      phase: "wbs_structure",
      code: w.code ?? "WBS_STRUCTURE",
      message: w.message,
    });
  }
  for (const w of validateGeneratedWbsForP6Export(generatedWbs)) {
    pushIssue(issues, {
      phase: "wbs_structure",
      code: w.code ?? "WBS_P6",
      message: w.message,
    });
  }

  const rateCardEntries = await getRateCardEntries(companyId);
  const projectCode = projectCodeFromIds(projectId, projectName);
  const pid = String(projectId).trim();
  const p6ProjCell = Number.isFinite(Number(pid)) ? Number(pid) : pid;

  const activityCatalog = await loadActivityCodeCatalogForExport(companyId, {
    activityIds: fragnet.activities.map((a) => a.id),
    deliverableIds: fragnet.deliverables.map((d) => d.id),
  });

  try {
    assertUniqueWbsPathsForSpreadsheet(generatedWbs, projectCode);
    assertActivityCodeCatalogConsistency(activityCatalog);
    assertAssignedResourcesExistOnRateCard(rateCardEntries, [...deliverablesForExport, ...activitiesForExport]);
  } catch (e) {
    pushIssue(issues, {
      phase: "p6_spreadsheet",
      code: "P6_SPREADSHEET",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  let pendingSemanticRows;
  let taskPredExportRows;
  try {
    const built = await generateFragnetXlsx(
      generatedWbs,
      deliverablesForExport,
      activitiesForExport,
      fragnet.relationships.map((r: Relationship) => ({
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      scenario,
      pid,
      projectCode,
      rateCardEntries,
      {
        exportContext: {
          companyId,
          ranaProjectId: fragnet.projectId,
          p6ProjIdCell: p6ProjCell,
          fragnetId: fragnet.id,
        },
        activityCatalog,
      },
      fragnet.deliverableRelationships.map((r) => ({
        predecessorDeliverableId: r.predecessorDeliverableId,
        successorDeliverableId: r.successorDeliverableId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      fragnet.deliverableActivityRelationships.map((r) => ({
        predecessorDeliverableId: r.predecessorDeliverableId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      }))
    );
    pendingSemanticRows = built.pendingSemanticRows;
    taskPredExportRows = built.taskPredExportRows;
  } catch (e) {
    pushIssue(issues, {
      phase: "xlsx",
      code: "XLSX_BUILD",
      message: e instanceof Error ? e.message : String(e),
    });
    return summarizePreflight(issues);
  }

  try {
    const xerString = await generateXERWithWBS(generatedWbs, pname, projectCode, rateCardEntries, {
      activityCatalog,
      pendingSemanticTaskRows: pendingSemanticRows,
      xerDeterministicScope: `${companyId}:${fragnet.projectId}:${projectCode}`,
      taskPredExportRows,
      assertValidOnComplete: false,
    });
    for (const x of collectXerValidationIssues(xerString)) {
      pushIssue(issues, {
        phase: "xer_validation",
        code: x.code,
        message: x.message,
      });
    }
  } catch (e) {
    pushIssue(issues, {
      phase: "xer_build",
      code: "XER_BUILD",
      message: e instanceof Error ? e.message : String(e),
    });
  }

  return summarizePreflight(issues);
}

function summarizePreflight(
  issues: ExportPreflightIssue[],
  assignment?: ActivityAssignmentValidationResult
): ExportPreflightResult {
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  return {
    ok: errorCount === 0,
    issues,
    assignment,
    errorCount,
    warningCount,
  };
}
