import type { Response } from "express";
import { RelationshipType } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import {
  createTemplate,
  createTemplateRelationship,
  listTemplatesForFragnet,
  materializeTemplatesForAllDeliverables,
  realignFragnetActivityCodes,
  syncTemplatesToDeliverables,
} from "../services/fragnetActivityTemplate.service.js";
import { replaceActivityCodeAssignmentsForTemplate } from "../services/activityCodeAssignments.service.js";
import { parseAndValidateAssignedResources } from "../services/rateCard.js";
import { Prisma } from "@prisma/client";

function parseDuration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}

async function loadFragnet(fragnetId: string, companyId: string) {
  return prisma.fragnet.findFirst({ where: { id: fragnetId, companyId } });
}

export async function list(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "fragnet", "read");
    const templates = await listTemplatesForFragnet(fragnetId, req.user.companyId);
    res.json(templates);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list activity templates" });
  }
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const body = req.body as {
      templateCode?: string;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      isSharedAcrossDeliverables?: boolean;
      orderIndex?: number;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "create");

    if (!body.templateCode?.trim() || !body.name?.trim()) {
      res.status(400).json({ error: "templateCode and name are required" });
      return;
    }
    const bestDuration = parseDuration(body.bestDuration);
    const likelyDuration = parseDuration(body.likelyDuration);
    if (bestDuration === null || bestDuration < 1 || likelyDuration === null || likelyDuration < 1) {
      res.status(400).json({ error: "bestDuration and likelyDuration must be positive integers" });
      return;
    }

    const template = await createTemplate(fragnet, {
      templateCode: body.templateCode,
      name: body.name,
      bestDuration,
      likelyDuration,
      isSharedAcrossDeliverables: Boolean(body.isSharedAcrossDeliverables),
      orderIndex: body.orderIndex,
      assignedResources: body.assignedResources,
      activityCodeByTypeId: body.activityCodeByTypeId,
    });
    res.status(201).json(template);
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      res.status(409).json({ error: "Template code already exists on this fragnet" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create activity template" });
  }
}

export async function update(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId, templateId } = req.params as { fragnetId: string; templateId: string };
    const body = req.body as {
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      isSharedAcrossDeliverables?: boolean;
      orderIndex?: number;
      assignedResources?: unknown;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "update");

    const existing = await prisma.fragnetActivityTemplate.findFirst({
      where: { id: templateId, fragnetId, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    if (
      body.isSharedAcrossDeliverables !== undefined &&
      Boolean(body.isSharedAcrossDeliverables) !== Boolean(existing.isSharedAcrossDeliverables)
    ) {
      const materializedCount = await prisma.activity.count({
        where: {
          companyId: req.user.companyId,
          templateActivityId: templateId,
        },
      });
      if (materializedCount > 0) {
        res.status(409).json({
          error:
            "Cannot change shared mode after activities have already been materialized for this template yet.",
        });
        return;
      }
    }

    const data: Prisma.FragnetActivityTemplateUpdateInput = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.orderIndex !== undefined) data.orderIndex = Number(body.orderIndex);
    if (body.bestDuration !== undefined) {
      const b = parseDuration(body.bestDuration);
      if (b === null || b < 1) {
        res.status(400).json({ error: "Invalid bestDuration" });
        return;
      }
      data.bestDuration = b;
    }
    if (body.likelyDuration !== undefined) {
      const l = parseDuration(body.likelyDuration);
      if (l === null || l < 1) {
        res.status(400).json({ error: "Invalid likelyDuration" });
        return;
      }
      data.likelyDuration = l;
    }
    if (body.isSharedAcrossDeliverables !== undefined) {
      data.isSharedAcrossDeliverables = Boolean(body.isSharedAcrossDeliverables);
    }
    if (body.assignedResources !== undefined) {
      const parsed = await parseAndValidateAssignedResources(req.user.companyId, body.assignedResources);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      data.assignedResources = parsed.assignments as Prisma.InputJsonValue;
    }

    const template = await prisma.fragnetActivityTemplate.update({
      where: { id: templateId },
      data,
    });
    if (body.activityCodeByTypeId !== undefined) {
      await replaceActivityCodeAssignmentsForTemplate({
        companyId: req.user.companyId,
        templateActivityId: templateId,
        byTypeId: body.activityCodeByTypeId,
      });
    }
    await syncTemplatesToDeliverables(fragnetId, req.user.companyId);
    const withCodes = await prisma.fragnetActivityTemplate.findFirst({
      where: { id: templateId },
      include: { activityCodeAssignments: { include: { type: true, code: true } } },
    });
    res.json(withCodes ?? template);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update activity template" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId, templateId } = req.params as { fragnetId: string; templateId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "delete");

    const existing = await prisma.fragnetActivityTemplate.findFirst({
      where: { id: templateId, fragnetId, companyId: req.user.companyId },
    });
    if (!existing) {
      res.status(404).json({ error: "Template not found" });
      return;
    }

    await prisma.fragnetActivityTemplate.delete({ where: { id: templateId } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete activity template" });
  }
}

export async function createRelationship(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const body = req.body as {
      predecessorTemplateId?: string;
      successorTemplateId?: string;
      relationshipType?: RelationshipType;
      lag?: number;
    };

    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "relationship", "create");

    if (!body.predecessorTemplateId || !body.successorTemplateId || !body.relationshipType) {
      res.status(400).json({ error: "predecessorTemplateId, successorTemplateId, and relationshipType are required" });
      return;
    }

    const rel = await createTemplateRelationship(fragnet, {
      predecessorTemplateId: body.predecessorTemplateId,
      successorTemplateId: body.successorTemplateId,
      relationshipType: body.relationshipType,
      lag: body.lag ?? 0,
    });
    res.status(201).json(rel);
  } catch (err: unknown) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as { status: number }).status) : 500;
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create template relationship" });
  }
}

export async function deleteRelationship(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId, relId } = req.params as { fragnetId: string; relId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "relationship", "delete");

    await prisma.fragnetTemplateRelationship.deleteMany({
      where: { id: relId, fragnetId, companyId: req.user.companyId },
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete template relationship" });
  }
}

export async function sync(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "update");

    const updated = await syncTemplatesToDeliverables(fragnetId, req.user.companyId);
    const materialized = await materializeTemplatesForAllDeliverables(fragnetId, req.user.companyId);
    res.json({ ...updated, ...materialized });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sync templates" });
  }
}

export async function materialize(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "update");

    const result = await materializeTemplatesForAllDeliverables(fragnetId, req.user.companyId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to materialize templates" });
  }
}

/** Re-prefix activity codes per deliverable (e.g. ARC-A1000) without re-cloning templates. */
export async function realignCodes(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params as { fragnetId: string };
    const fragnet = await loadFragnet(fragnetId, req.user.companyId);
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    const membership = await requireProjectAccess(fragnet.projectId, req.user);
    requirePermission(membership.role, "activity", "update");

    const result = await realignFragnetActivityCodes(fragnetId, req.user.companyId);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to realign activity codes" });
  }
}
