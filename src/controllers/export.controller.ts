import type { Relationship } from "@prisma/client";
import type { Response } from "express";
import JSZip from "jszip";
import * as XLSX from "xlsx";
import { prisma } from "../utils/prisma.js";
import { assignmentsFromDb, getRateCardEntries } from "../services/rateCard.js";
import type { DeliverableWithActivities } from "../services/deliverableActivityLink.service.js";
import { buildWbsFromDeliverables } from "../services/wbsGenerate.service.js";
import { auditLog } from "../services/audit.service.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import {
  validateFragnetForWbsExport,
  validateGeneratedWbsStructure,
} from "../services/wbsExportValidation.service.js";
import { generateFragnetXlsx, type ExportScenario, type DeliverableForExport } from "../services/export.service.js";
import { generateHumanReadableWBS } from "../services/wbsHumanReadable.service.js";
import { generateXERWithWBS } from "../services/xerTemplateInject.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";

const VALID_SCENARIOS: ExportScenario[] = ["best", "likely"];

export async function exportFragnet(req: AuthRequest, res: Response): Promise<void> {
  try {
    const companyId = req.user?.companyId;
    const userId = req.user?.id;
    if (!companyId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const body = req.body as {
      scenario?: string;
      projectName?: string;
      projectId?: string;
      unassignedDeliverableIds?: string[];
    };

    const scenario = body.scenario;
    const projectName = body.projectName;
    const projectId = body.projectId;
    const unassignedDeliverableIds = Array.isArray(body.unassignedDeliverableIds)
      ? body.unassignedDeliverableIds.filter((id) => typeof id === "string" && id.trim() !== "")
      : [];

    if (scenario === undefined || scenario === null || String(scenario).trim() === "") {
      res.status(400).json({ error: "scenario is required" });
      return;
    }
    if (!VALID_SCENARIOS.includes(scenario as ExportScenario)) {
      res.status(400).json({ error: "scenario must be 'best' or 'likely'" });
      return;
    }
    if (projectName === undefined || projectName === null || String(projectName).trim() === "") {
      res.status(400).json({ error: "projectName is required" });
      return;
    }
    if (projectId === undefined || projectId === null || String(projectId).trim() === "") {
      res.status(400).json({ error: "projectId is required" });
      return;
    }

    const fragnet = await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId },
      include: {
        activities: { where: { companyId }, orderBy: { createdAt: "asc" } },
        relationships: true,
        deliverables: { where: { companyId }, orderBy: { createdAt: "asc" } },
      },
    });

    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "fragnet", "read");

    const wbsExportIssues = validateFragnetForWbsExport(fragnet);
    if (wbsExportIssues.length > 0) {
      res.status(400).json({
        error: "WBS export validation failed",
        issues: wbsExportIssues,
      });
      return;
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

    let unassignedForExport: DeliverableForExport[] = [];
    if (unassignedDeliverableIds.length > 0) {
      const unassigned = await prisma.deliverable.findMany({
        where: { companyId, fragnetId: null, id: { in: unassignedDeliverableIds } },
        orderBy: { createdAt: "asc" },
      });
      unassignedForExport = await Promise.all(
        unassigned.map(async (d) => ({
          id: d.id,
          name: d.name,
          bestDuration: d.bestDuration,
          likelyDuration: d.likelyDuration,
          createdAt: d.createdAt,
          assignedResources: await assignmentsFromDb(companyId, d.assignedResources),
        }))
      );
    }

    const activitiesForExport = await Promise.all(
      fragnet.activities.map(async (a) => ({
        id: a.id,
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
    const generatedWbs = buildWbsFromDeliverables(String(projectName).trim(), deliverablesWithActivities);
    const structureIssues = validateGeneratedWbsStructure(generatedWbs);
    if (structureIssues.length > 0) {
      res.status(500).json({
        error: "Internal WBS structure validation failed",
        issues: structureIssues,
      });
      return;
    }
    console.log(
      "[export] Resource assignments per activity:",
      activitiesForExport.map((a) => ({ id: a.id, name: a.name, count: a.assignedResources.length }))
    );

    const rateCardEntries = await getRateCardEntries(companyId);

    const pid = String(projectId).trim();
    const pname = String(projectName).trim();
    // If the user-provided project code accidentally carries a trailing "1"
    // (e.g. "NEWPROJ-50901" instead of "NEWPROJ-5090"), drop it when it matches the name+1 pattern.
    const projectCode = pid !== "" && pname !== "" && pid === `${pname}1` ? pname : pid;

    const buffer = generateFragnetXlsx(
      generatedWbs,
      deliverablesForExport,
      activitiesForExport,
      fragnet.relationships.map((r: Relationship) => ({
        predecessorActivityId: r.predecessorActivityId,
        successorActivityId: r.successorActivityId,
        relationshipType: r.relationshipType,
        lag: r.lag,
      })),
      scenario as ExportScenario,
      pid,
      projectCode,
      unassignedForExport,
      rateCardEntries
    );
    const safeName = (pname.replace(/[^a-z0-9]/gi, "_").toLowerCase().replace(/_+/g, "_").replace(/^_+|_+$/g, "") || "project");

    const wbsReviewRows = generateHumanReadableWBS(generatedWbs);
    const wbsReviewSheet = XLSX.utils.json_to_sheet(
      wbsReviewRows.map((r) => ({
        "WBS ID": r.wbs_id,
        "WBS Short Name": r.wbs_short_name,
        "Parent WBS": r.parent_wbs ?? "",
        "WBS (Name)": r.wbs_name,
      }))
    );
    const wbsReviewWb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbsReviewWb, wbsReviewSheet, "WBS");
    const wbsReviewBuffer = XLSX.write(wbsReviewWb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const xerString = await generateXERWithWBS(generatedWbs, pname, projectCode, rateCardEntries);
    const zip = new JSZip();
    zip.file(`${safeName}_fragnet.xlsx`, buffer);
    zip.file(`${safeName}_wbs_review.xlsx`, wbsReviewBuffer);
    zip.file(`${projectCode || "project"}.xer`, Buffer.from(xerString, "utf-8"));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

    if (userId) {
      await auditLog({
        userId,
        companyId,
        projectId: fragnet.projectId,
        action: "EXPORT_FRAGNET",
        entity: "Fragnet",
        entityId: fragnetId,
      });
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}_export.zip"`);
    res.status(200).send(zipBuffer);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to export fragnet" });
  }
}
