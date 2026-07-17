import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { parseAndValidateAssignedResources } from "../services/rateCard.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { auditUpdateIfChanged } from "../services/shared/auditDiff.service.js";
import { replaceActivityCodeAssignmentsForDeliverable } from "../services/activityCodeAssignments.service.js";
import { materializeTemplatesForDeliverable } from "../services/fragnetActivityTemplate.service.js";
import type { DeliverableClassification } from "@prisma/client";
import { classifyDeliverableName } from "../services/intelligence/profiles/deliverableClassification.service.js";
import {
  getDeliverableDurationStatisticsPresentation,
  type HistoricalDurationTarget,
} from "../services/deliverableDurationStatisticsPresentation.service.js";

/**
 * Prisma `DeliverableInclude` must list `activityCodeAssignments` (schema + `npx prisma generate`).
 * `as unknown as` avoids false positives when the editor resolves an older generated client than `tsc`.
 */
const includeDeliverableActivityCodes = {
  activityCodeAssignments: { include: { type: true as const, code: true as const } },
} as unknown as Prisma.DeliverableInclude;

function parseDuration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const {
      fragnetId,
      projectId: projectIdRaw,
      externalProjectId: externalProjectIdRaw,
      name,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assignedResources: assignedResourcesRaw,
      activityCodeByTypeId,
    } = req.body as {
      fragnetId?: string;
      projectId?: string;
      externalProjectId?: string | null;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const fragnetIdTrimmed =
      fragnetId !== undefined && fragnetId !== null && String(fragnetId).trim() !== ""
        ? String(fragnetId).trim()
        : null;

    const projectIdStr = projectIdRaw != null ? String(projectIdRaw).trim() : "";
    if (!projectIdStr) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    const membership = await requireProjectAccess(projectIdStr, req.user);
    requirePermission(membership.role, "deliverable", "create");

    if (fragnetIdTrimmed !== null) {
      const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetIdTrimmed, companyId: req.user.companyId } });
      if (!fragnet) {
        res.status(404).json({ error: "Fragnet not found" });
        return;
      }
      if (fragnet.projectId !== projectIdStr) {
        res.status(400).json({ error: "Fragnet must belong to the same project" });
        return;
      }
    }

    if (name === undefined || name === null || String(name).trim() === "") {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const bestDuration = parseDuration(bestDurationRaw);
    const likelyDuration = parseDuration(likelyDurationRaw);
    if (bestDuration === null || bestDuration < 1) {
      res.status(400).json({ error: "bestDuration must be a positive integer" });
      return;
    }
    if (likelyDuration === null || likelyDuration < 1) {
      res.status(400).json({ error: "likelyDuration must be a positive integer" });
      return;
    }

    const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
    if (!assignedParsed.ok) {
      res.status(400).json({ error: assignedParsed.error });
      return;
    }

    const externalProjectIdTrimmed =
      externalProjectIdRaw !== undefined && externalProjectIdRaw !== null && String(externalProjectIdRaw).trim() !== ""
        ? String(externalProjectIdRaw).trim()
        : null;

    const createData: Prisma.DeliverableUncheckedCreateInput = {
      fragnetId: fragnetIdTrimmed,
      projectId: projectIdStr,
      externalProjectId: externalProjectIdTrimmed,
      name: String(name).trim(),
      classification: classifyDeliverableName(String(name).trim()),
      bestDuration,
      likelyDuration,
      assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
      companyId: req.user.companyId,
    };
    const deliverable = await prisma.deliverable.create({ data: createData });
    try {
      await replaceActivityCodeAssignmentsForDeliverable({
        companyId: req.user.companyId,
        deliverableId: deliverable.id,
        byTypeId: activityCodeByTypeId,
      });
    } catch (e) {
      const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
      if (st === 400) {
        await prisma.deliverable.delete({ where: { id: deliverable.id } });
        res.status(400).json({ error: (e as Error).message || "Invalid activity codes" });
        return;
      }
      throw e;
    }
    if (fragnetIdTrimmed) {
      try {
        await materializeTemplatesForDeliverable(deliverable.id, req.user.companyId);
      } catch (matErr) {
        console.error("materializeTemplatesForDeliverable", matErr);
      }
    }
    const deliverableOut = await prisma.deliverable.findFirstOrThrow({
      where: { id: deliverable.id, companyId: req.user.companyId },
      include: includeDeliverableActivityCodes,
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: projectIdStr,
      action: "CREATE_DELIVERABLE",
      entity: "Deliverable",
      entityId: deliverable.id,
    });
    res.status(201).json(deliverableOut);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create deliverable" });
  }
}

export async function getAll(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    await requireProjectAccess(projectId, req.user);
    const fragnetId = typeof req.query.fragnetId === "string" ? req.query.fragnetId.trim() : undefined;
    const deliverables = await prisma.deliverable.findMany({
      where: fragnetId ? { companyId: req.user.companyId, projectId, fragnetId } : { companyId: req.user.companyId, projectId },
      orderBy: { createdAt: "desc" },
      include: includeDeliverableActivityCodes,
    });
    res.json(deliverables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverables" });
  }
}

export async function queryDurationStatistics(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const body = req.body as { projectId?: unknown; targets?: unknown };
    const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    if (body.targets !== undefined && !Array.isArray(body.targets)) {
      res.status(400).json({ error: "targets must be an array when provided" });
      return;
    }

    const membership = await requireProjectAccess(projectId, req.user);
    requirePermission(membership.role, "deliverable", "read");
    const result = await getDeliverableDurationStatisticsPresentation({
      companyId: req.user.companyId,
      projectId,
      targets: body.targets as HistoricalDurationTarget[] | undefined,
    });
    res.json(result);
  } catch (err) {
    const status =
      err && typeof err === "object" && "status" in err
        ? Number((err as { status?: unknown }).status)
        : 500;
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: err instanceof Error ? err.message : "Invalid request" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to fetch historical duration statistics" });
  }
}

/** GET /deliverables/fragnet/:fragnetId – list deliverables for that fragnet */
export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetId, companyId: req.user.companyId } });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    const deliverables = await prisma.deliverable.findMany({
      where: { companyId: req.user.companyId, projectId: fragnet.projectId, fragnetId },
      orderBy: { createdAt: "asc" },
      include: includeDeliverableActivityCodes,
    });
    res.json(deliverables);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverables for fragnet" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const deliverable = await prisma.deliverable.findFirst({
      where: { id, companyId: req.user.companyId },
      include: includeDeliverableActivityCodes,
    });
    if (!deliverable) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    await requireProjectAccess(deliverable.projectId, req.user);
    res.json(deliverable);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch deliverable" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const {
      fragnetId: fragnetIdRaw,
      externalProjectId: externalProjectIdRaw,
      name,
      classification,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assignedResources: assignedResourcesRaw,
      activityCodeByTypeId,
    } = req.body as {
      fragnetId?: string;
      externalProjectId?: string | null;
      name?: string;
      classification?: DeliverableClassification | null;
      bestDuration?: number;
      likelyDuration?: number;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const existing = await prisma.deliverable.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "deliverable", "update");

    const fragnetIdTrimmed =
      fragnetIdRaw !== undefined && fragnetIdRaw !== null
        ? (String(fragnetIdRaw).trim() || null)
        : undefined;
    if (fragnetIdTrimmed !== undefined) {
      if (fragnetIdTrimmed !== null) {
        const fragnet = await prisma.fragnet.findFirst({ where: { id: fragnetIdTrimmed, companyId: req.user.companyId } });
        if (!fragnet) {
          res.status(404).json({ error: "Fragnet not found" });
          return;
        }
        if (fragnet.projectId !== existing.projectId) {
          res.status(400).json({ error: "Fragnet must belong to the same project" });
          return;
        }
      }
    }

    if (bestDurationRaw !== undefined) {
      const bestDuration = parseDuration(bestDurationRaw);
      if (bestDuration === null || bestDuration < 1) {
        res.status(400).json({ error: "bestDuration must be a positive integer" });
        return;
      }
    }
    if (likelyDurationRaw !== undefined) {
      const likelyDuration = parseDuration(likelyDurationRaw);
      if (likelyDuration === null || likelyDuration < 1) {
        res.status(400).json({ error: "likelyDuration must be a positive integer" });
        return;
      }
    }

    let assignedUpdate: Prisma.InputJsonValue | undefined;
    if (assignedResourcesRaw !== undefined) {
      const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
      if (!assignedParsed.ok) {
        res.status(400).json({ error: assignedParsed.error });
        return;
      }
      assignedUpdate = assignedParsed.assignments as Prisma.InputJsonValue;
    }

    const externalProjectIdTrimmed =
      externalProjectIdRaw !== undefined
        ? externalProjectIdRaw != null && String(externalProjectIdRaw).trim() !== ""
          ? String(externalProjectIdRaw).trim()
          : null
        : undefined;

    const updateData: Prisma.DeliverableUncheckedUpdateInput = {
      ...(fragnetIdTrimmed !== undefined && { fragnetId: fragnetIdTrimmed }),
      ...(externalProjectIdTrimmed !== undefined && { externalProjectId: externalProjectIdTrimmed }),
      ...(name !== undefined && { name: String(name).trim() }),
      ...(classification !== undefined && { classification: classification == null ? null : classification }),
      ...(bestDurationRaw !== undefined && { bestDuration: parseDuration(bestDurationRaw)! }),
      ...(likelyDurationRaw !== undefined && { likelyDuration: parseDuration(likelyDurationRaw)! }),
      ...(assignedUpdate !== undefined && { assignedResources: assignedUpdate }),
    };
    const deliverable =
      Object.keys(updateData).length > 0
        ? await prisma.deliverable.update({
            where: { id },
            data: updateData,
          })
        : await prisma.deliverable.findFirstOrThrow({ where: { id, companyId: req.user.companyId } });
    if (activityCodeByTypeId !== undefined) {
      try {
        await replaceActivityCodeAssignmentsForDeliverable({
          companyId: req.user.companyId,
          deliverableId: id,
          byTypeId: activityCodeByTypeId,
        });
      } catch (e) {
        const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
        if (st === 400) {
          res.status(400).json({ error: (e as Error).message || "Invalid activity codes" });
          return;
        }
        throw e;
      }
    }
    const deliverableOut = await prisma.deliverable.findFirstOrThrow({
      where: { id: deliverable.id, companyId: req.user.companyId },
      include: includeDeliverableActivityCodes,
    });
    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_DELIVERABLE",
      entity: "Deliverable",
      entityId: id,
      before: existing as any,
      after: deliverableOut as any,
      fields: [
        "name",
        "fragnetId",
        "classification",
        "bestDuration",
        "likelyDuration",
        "assignedResources",
        "externalProjectId",
      ],
    });
    res.json(deliverableOut);
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update deliverable" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = await prisma.deliverable.findFirst({ where: { id, companyId: req.user.companyId } });
    if (!existing) {
      res.status(404).json({ error: "Deliverable not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "deliverable", "delete");
    await prisma.deliverable.delete({ where: { id } });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_DELIVERABLE",
      entity: "Deliverable",
      entityId: id,
    });
    res.status(204).send();
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      // Prisma P2003 can be thrown without a reliable field name depending on provider/version.
      // For deliverable deletion, treat any FK constraint as "record in use".
      res.status(409).json({ error: "Cannot delete deliverable: it is referenced by other records (e.g. activities). Remove those references first." });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete deliverable" });
  }
}
