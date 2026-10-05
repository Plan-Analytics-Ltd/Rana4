import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "../utils/prisma.js";
import { parseAndValidateAssignedResources } from "../services/rateCard.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { isPrismaForeignKeyViolation } from "../utils/prismaErrors.js";
import { auditLog, auditLogMany } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import { transitionActivityStatus } from "../services/activityStatus.service.js";
import { auditUpdateIfChanged } from "../services/shared/auditDiff.service.js";
import { getActivityVersions } from "../services/activityVersions.service.js";
import { rollbackActivityToVersion } from "../services/activityRollback.service.js";
import { changeApprovalState } from "../services/activityApproval.service.js";
import { replaceActivityCodeAssignmentsForActivity } from "../services/activityCodeAssignments.service.js";
import { checkActivityCodeAvailability } from "../services/activityCodeSequence.service.js";
import { detachActivityFromTemplate } from "../services/fragnetActivityTemplate.service.js";
import {
  ensureProjectLevelActivityContext,
  getProjectLevelActivityContext,
} from "../services/projectLevelActivityContext.service.js";
import { recalculateProjectScheduleAfterMutation } from "../services/scheduleAutoRecalc.service.js";
import {
  activityDeliverableInclude,
  serializeLinkedDeliverables,
  syncActivityDeliverableLinks,
} from "../services/activityDeliverableLinks.service.js";
import { bootstrapSharedActivityRelationshipsForFragnet } from "../services/sharedActivityRelationshipBootstrap.service.js";
import { createNonSharedActivityOnAllFragnetDeliverables } from "../services/activityCreation.service.js";
import {
  syncDeliverableToFirstActivityFsLink,
  syncFragnetDeliverableToFirstActivityFsLinks,
} from "../services/deliverableFirstActivityLink.service.js";
import {
  applyActivityDeleteSideEffects,
  noteActivityDeleteLinkageTarget,
} from "../services/activityDeleteSideEffects.service.js";
import { captureLiveBaselineSnapshot } from "../services/intelligence/shared/programmeSnapshotCapture.service.js";
import type { ProjectRole } from "../permissions/projectPermissions.js";
const activityInclude = {
  activityCodeAssignments: { include: { type: true as const, code: true as const } },
  ...activityDeliverableInclude,
};

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code: string }).code === "P2002"
  );
}

function parseDuration(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  if (Number.isNaN(n) || !Number.isInteger(n)) return null;
  return n;
}

/**
 * Capture a live ProgrammeSnapshot after an activity create/update/delete commits.
 * These fire on every activity mutation, so LLM reasoning is always forced off
 * (rule-based only) to avoid runaway cost/latency — only real imports (XER, Excel)
 * get full LLM-based reasoning. Failures are logged but never fail the CRUD request.
 */
async function captureLiveActivitySnapshot(
  projectId: string,
  companyId: string,
  userId: string | undefined,
  operation: string
): Promise<void> {
  try {
    await captureLiveBaselineSnapshot(projectId, companyId, userId, `Live update (${operation})`, {
      forceRuleBasedReasoning: true,
    });
  } catch (err) {
    console.error(
      `[activities.controller] Failed to capture live programme snapshot after ${operation} (projectId=${projectId})`,
      err
    );
  }
}

async function resolveCreateActivityContext(args: {
  companyId: string;
  projectId?: string;
  fragnetId?: string;
  deliverableId?: string;
}): Promise<
  | { ok: true; projectId: string; fragnetId: string; standardId: string | null; deliverableId: string }
  | { ok: false; status: number; error: string }
> {
  const projectId = String(args.projectId ?? "").trim();
  const fragnetId = String(args.fragnetId ?? "").trim();
  const deliverableId = String(args.deliverableId ?? "").trim();

  if (deliverableId) {
    const deliverable = await prisma.deliverable.findFirst({
      where: { id: deliverableId, companyId: args.companyId },
    });
    if (!deliverable) return { ok: false, status: 400, error: "Deliverable not found" };

    if (deliverable.fragnetId) {
      const fragnet = await prisma.fragnet.findFirst({
        where: { id: deliverable.fragnetId, companyId: args.companyId },
        select: { id: true, projectId: true, standardId: true },
      });
      if (!fragnet) return { ok: false, status: 400, error: "Deliverable fragnet not found" };
      return {
        ok: true,
        projectId: fragnet.projectId,
        fragnetId: fragnet.id,
        standardId: fragnet.standardId,
        deliverableId: deliverable.id,
      };
    }

    const ctx = await ensureProjectLevelActivityContext(deliverable.projectId, args.companyId);
    await prisma.deliverable.update({
      where: { id: deliverable.id },
      data: { fragnetId: ctx.fragnet.id },
    });
    return {
      ok: true,
      projectId: deliverable.projectId,
      fragnetId: ctx.fragnet.id,
      standardId: ctx.standard.id,
      deliverableId: deliverable.id,
    };
  }

  if (fragnetId) {
    const fragnet = await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: args.companyId },
      select: { id: true, projectId: true, standardId: true },
    });
    if (!fragnet) return { ok: false, status: 404, error: "Fragnet not found" };
    const deliverable = await prisma.deliverable.findFirst({
      where: { companyId: args.companyId, projectId: fragnet.projectId, fragnetId: fragnet.id },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!deliverable) {
      return { ok: false, status: 400, error: "No deliverables exist on this fragnet. Select a deliverable or use project-level mode." };
    }
    return {
      ok: true,
      projectId: fragnet.projectId,
      fragnetId: fragnet.id,
      standardId: fragnet.standardId,
      deliverableId: deliverable.id,
    };
  }

  if (!projectId) {
    return { ok: false, status: 400, error: "projectId, fragnetId, or deliverableId is required" };
  }

  const ctx = await ensureProjectLevelActivityContext(projectId, args.companyId);
  return {
    ok: true,
    projectId,
    fragnetId: ctx.fragnet.id,
    standardId: ctx.standard.id,
    deliverableId: ctx.deliverable.id,
  };
}

async function resolveLinkedDeliverableIds(args: {
  companyId: string;
  projectId: string;
  fragnetId: string;
  primaryDeliverableId: string;
  deliverableIds?: string[];
}): Promise<{ ok: true; deliverableIds: string[] } | { ok: false; status: number; error: string }> {
  const deliverableIds = [
    args.primaryDeliverableId,
    ...(args.deliverableIds ?? []).map((id) => String(id ?? "").trim()),
  ].filter(Boolean);
  const uniqueIds = [...new Set(deliverableIds)];
  const deliverables = await prisma.deliverable.findMany({
    where: { id: { in: uniqueIds }, companyId: args.companyId },
    select: { id: true, projectId: true, fragnetId: true },
  });
  if (deliverables.length !== uniqueIds.length) {
    return { ok: false, status: 400, error: "One or more linked deliverables were not found" };
  }

  for (const deliverable of deliverables) {
    if (deliverable.projectId !== args.projectId) {
      return { ok: false, status: 400, error: "Linked deliverables must belong to the same project" };
    }
    let resolvedFragnetId = deliverable.fragnetId;
    if (!resolvedFragnetId) {
      const ctx = await ensureProjectLevelActivityContext(args.projectId, args.companyId);
      await prisma.deliverable.update({
        where: { id: deliverable.id },
        data: { fragnetId: ctx.fragnet.id },
      });
      resolvedFragnetId = ctx.fragnet.id;
    }
    if (resolvedFragnetId !== args.fragnetId) {
      return { ok: false, status: 400, error: "Linked deliverables must belong to the same fragnet" };
    }
  }

  return { ok: true, deliverableIds: uniqueIds };
}

export async function create(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const {
      projectId: projectIdRaw,
      fragnetId,
      deliverableId: deliverableIdRaw,
      deliverableIds: deliverableIdsRaw,
      activityCode,
      name,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assuranceNoteId,
      assignedResources: assignedResourcesRaw,
      isSharedAcrossDeliverables,
      activityCodeByTypeId,
    } = req.body as {
      projectId?: string;
      fragnetId?: string;
      deliverableId?: string;
      deliverableIds?: string[];
      activityCode?: string;
      name?: string;
      bestDuration?: number;
      likelyDuration?: number;
      assuranceNoteId?: string | null;
      assignedResources?: unknown;
      isSharedAcrossDeliverables?: boolean;
      activityCodeByTypeId?: Record<string, string | null>;
    };
    if (activityCode === undefined || activityCode === null || String(activityCode).trim() === "") {
      res.status(400).json({ error: "activityCode is required" });
      return;
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

    const resolved = await resolveCreateActivityContext({
      companyId: req.user.companyId,
      projectId: projectIdRaw != null ? String(projectIdRaw).trim() : undefined,
      fragnetId: fragnetId != null ? String(fragnetId).trim() : undefined,
      deliverableId: deliverableIdRaw != null ? String(deliverableIdRaw).trim() : undefined,
    });
    if (!resolved.ok) {
      res.status(resolved.status).json({ error: resolved.error });
      return;
    }
    const linkedDeliverables = await resolveLinkedDeliverableIds({
      companyId: req.user.companyId,
      projectId: resolved.projectId,
      fragnetId: resolved.fragnetId,
      primaryDeliverableId: resolved.deliverableId,
      deliverableIds: Array.isArray(deliverableIdsRaw) ? deliverableIdsRaw : undefined,
    });
    if (!linkedDeliverables.ok) {
      res.status(linkedDeliverables.status).json({ error: linkedDeliverables.error });
      return;
    }

    const membership = await requireProjectAccess(resolved.projectId, req.user);
    requirePermission(membership.role, "activity", "create");

    const assuranceNoteIdTrimmed =
      assuranceNoteId != null && String(assuranceNoteId).trim() !== ""
        ? String(assuranceNoteId).trim()
        : null;
    if (assuranceNoteIdTrimmed) {
      const note = (await prisma.assuranceNote.findFirst({
        where: { id: assuranceNoteIdTrimmed, companyId: req.user.companyId },
      })) as { id: string; standardId: string; projectId: string } | null;
      if (!note) {
        res.status(400).json({ error: "Assurance note not found" });
        return;
      }
      if (!resolved.standardId || note.standardId !== resolved.standardId) {
        res.status(400).json({ error: "Assurance note must belong to the same standard as the fragnet" });
        return;
      }
      if (note.projectId !== resolved.projectId) {
        res.status(400).json({ error: "Assurance note must belong to the same project as the activity" });
        return;
      }
    }

    const assignedParsed = await parseAndValidateAssignedResources(req.user.companyId, assignedResourcesRaw);
    if (!assignedParsed.ok) {
      res.status(400).json({ error: assignedParsed.error });
      return;
    }

    const nameTrimmed = String(name).trim();
    if (Boolean(isSharedAcrossDeliverables)) {
      // Manual shared activities should reuse an existing shared node in the fragnet (MVP: exact name match).
      const existingShared = await prisma.activity.findFirst({
        where: {
          companyId: req.user.companyId,
          projectId: resolved.projectId,
          fragnetId: resolved.fragnetId,
          isSharedAcrossDeliverables: true,
          name: nameTrimmed,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: activityInclude,
      });
      if (existingShared) {
        await syncActivityDeliverableLinks({
          activityId: existingShared.id,
          primaryDeliverableId: resolved.deliverableId,
          deliverableIds: linkedDeliverables.deliverableIds,
          projectId: resolved.projectId,
          companyId: req.user.companyId,
        });
        await bootstrapSharedActivityRelationshipsForFragnet({
          fragnetId: resolved.fragnetId,
          companyId: req.user.companyId,
        });
        await recalculateProjectScheduleAfterMutation(resolved.projectId, req.user.companyId);
        await captureLiveActivitySnapshot(resolved.projectId, req.user.companyId, req.user.id, "activity.create");
        res.status(201).json(serializeLinkedDeliverables(existingShared as any));
        return;
      }
    }

    const codeCheck = await checkActivityCodeAvailability({
      projectId: resolved.projectId,
      companyId: req.user.companyId,
      fragnetId: resolved.fragnetId,
      userCode: String(activityCode),
    });
    if (!codeCheck.available || !codeCheck.normalizedCode) {
      res.status(400).json({
        error: codeCheck.message,
        suggestedCode: codeCheck.suggestedCode ?? undefined,
      });
      return;
    }
    const resolvedCode = codeCheck.normalizedCode;

    if (!Boolean(isSharedAcrossDeliverables)) {
      try {
        const { primaryActivityId } = await createNonSharedActivityOnAllFragnetDeliverables({
          companyId: req.user.companyId,
          projectId: resolved.projectId,
          fragnetId: resolved.fragnetId,
          standardId: resolved.standardId,
          primaryDeliverableId: resolved.deliverableId,
          name: nameTrimmed,
          bestDuration,
          likelyDuration,
          assuranceNoteId: assuranceNoteIdTrimmed,
          assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
          primaryActivityCode: resolvedCode,
          activityCodeByTypeId,
        });
        const activityWithCodes = await prisma.activity.findFirstOrThrow({
          where: { id: primaryActivityId, companyId: req.user.companyId },
          include: activityInclude,
        });
        await auditLog({
          userId: req.user.id,
          companyId: req.user.companyId,
          projectId: resolved.projectId,
          action: "CREATE_ACTIVITY",
          entity: "Activity",
          entityId: primaryActivityId,
        });
        await recalculateProjectScheduleAfterMutation(resolved.projectId, req.user.companyId);
        await captureLiveActivitySnapshot(resolved.projectId, req.user.companyId, req.user.id, "activity.create");
        res.status(201).json(serializeLinkedDeliverables(activityWithCodes));
        return;
      } catch (e) {
        const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
        if (st === 400) {
          res.status(400).json({ error: (e as Error).message });
          return;
        }
        throw e;
      }
    }

    const createData = {
      fragnetId: resolved.fragnetId,
      deliverableId: resolved.deliverableId,
      activityCode: resolvedCode,
      name: nameTrimmed,
      bestDuration,
      likelyDuration,
      assuranceNoteId: assuranceNoteIdTrimmed,
      assignedResources: assignedParsed.assignments as Prisma.InputJsonValue,
      projectId: resolved.projectId,
      companyId: req.user.companyId,
      isSharedAcrossDeliverables: true,
      isInherited: false,
      detachedFromTemplate: true,
    };
    const activity = await prisma.activity.create({ data: createData });
    await syncActivityDeliverableLinks({
      activityId: activity.id,
      primaryDeliverableId: resolved.deliverableId,
      deliverableIds: linkedDeliverables.deliverableIds,
      projectId: resolved.projectId,
      companyId: req.user.companyId,
    });
    try {
      await replaceActivityCodeAssignmentsForActivity({
        companyId: req.user.companyId,
        activityId: activity.id,
        byTypeId: activityCodeByTypeId,
      });
    } catch (e) {
      const st = e && typeof e === "object" && "status" in e ? Number((e as any).status) : undefined;
      if (st === 400) {
        await prisma.activity.delete({ where: { id: activity.id } });
        res.status(400).json({ error: (e as Error).message || "Invalid activity codes" });
        return;
      }
      throw e;
    }
    const activityWithCodes = await prisma.activity.findFirstOrThrow({
      where: { id: activity.id, companyId: req.user.companyId },
      include: activityInclude,
    });
    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: resolved.projectId,
      action: "CREATE_ACTIVITY",
      entity: "Activity",
      entityId: activity.id,
    });
    await bootstrapSharedActivityRelationshipsForFragnet({
      fragnetId: resolved.fragnetId,
      companyId: req.user.companyId,
    });
    if (resolved.deliverableId) {
      const { syncDeliverableActivityLinkage } = await import(
        "../services/deliverableActivityChain.service.js"
      );
      await syncDeliverableActivityLinkage(resolved.deliverableId, req.user.companyId);
    }
    await recalculateProjectScheduleAfterMutation(resolved.projectId, req.user.companyId);
    await captureLiveActivitySnapshot(resolved.projectId, req.user.companyId, req.user.id, "activity.create");
    res.status(201).json(serializeLinkedDeliverables(activityWithCodes));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      res.status(400).json({ error: "activityCode already exists for this fragnet" });
      return;
    }
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create activity" });
  }
}

export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = (await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: req.user.companyId },
      include: { activities: { where: { companyId: req.user.companyId }, orderBy: { activityCode: "asc" }, include: activityInclude } },
    })) as ({ projectId: string; activities: unknown[] } & Record<string, unknown>) | null;
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    res.json((fragnet.activities as any[]).map((activity) => serializeLinkedDeliverables(activity)));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activities" });
  }
}

export async function getProjectLevelContext(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { projectId } = req.params as { projectId: string };
    await requireProjectAccess(projectId, req.user);
    const context = await getProjectLevelActivityContext(projectId, req.user.companyId);
    res.json({
      ...context,
      activities: (context.activities as any[]).map((activity) => serializeLinkedDeliverables(activity)),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch project-level activity context" });
  }
}

export async function getById(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const activity = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
      include: activityInclude,
    })) as { projectId: string } | null;
    if (!activity) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    await requireProjectAccess(activity.projectId, req.user);
    res.json(serializeLinkedDeliverables(activity as any));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activity" });
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
      activityCode,
      name,
      deliverableId: deliverableIdRaw,
      deliverableIds: deliverableIdsRaw,
      bestDuration: bestDurationRaw,
      likelyDuration: likelyDurationRaw,
      assuranceNoteId,
      assignedResources: assignedResourcesRaw,
      isSharedAcrossDeliverables,
      activityCodeByTypeId,
    } = req.body as {
      activityCode?: string;
      name?: string;
      deliverableId?: string;
      deliverableIds?: string[];
      bestDuration?: number;
      likelyDuration?: number;
      assuranceNoteId?: string | null;
      assignedResources?: unknown;
      isSharedAcrossDeliverables?: boolean;
      activityCodeByTypeId?: Record<string, string | null>;
    };

    const existing = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
      include: { deliverableLinks: { select: { deliverableId: true }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }] } },
    })) as {
      id: string;
      fragnetId: string;
      projectId: string;
      status: string;
      deliverableId: string;
      isSharedAcrossDeliverables: boolean;
      deliverableLinks: { deliverableId: string }[];
    } | null;
    if (!existing) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    requirePermission(membership.role, "activity", "update", { status: existing.status, operation: "edit" });

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

    const assuranceNoteIdTrimmed =
      assuranceNoteId !== undefined
        ? assuranceNoteId != null && String(assuranceNoteId).trim() !== ""
          ? String(assuranceNoteId).trim()
          : null
        : undefined;
    let targetFragnetId = existing.fragnetId;
    let targetStandardId: string | null | undefined;

    if (assuranceNoteIdTrimmed !== undefined && assuranceNoteIdTrimmed !== null) {
      const fragnet = (await prisma.fragnet.findFirst({
        where: { id: existing.fragnetId, companyId: req.user.companyId },
      })) as { id: string; standardId: string } | null;
      targetStandardId = fragnet?.standardId ?? null;
      const note = (await prisma.assuranceNote.findFirst({
        where: { id: assuranceNoteIdTrimmed, companyId: req.user.companyId },
      })) as { id: string; standardId: string; projectId: string } | null;
      if (!note || !fragnet || note.standardId !== fragnet.standardId) {
        res.status(400).json({ error: "Assurance note must belong to the same standard as the fragnet" });
        return;
      }
      if (note.projectId !== existing.projectId) {
        res.status(400).json({ error: "Assurance note must belong to the same project as the activity" });
        return;
      }
    }

    const requestedPrimaryDeliverableId =
      deliverableIdRaw !== undefined
        ? deliverableIdRaw
        : Array.isArray(deliverableIdsRaw) && deliverableIdsRaw.length > 0
          ? deliverableIdsRaw[0]
          : undefined;

    let resolvedDeliverableId: string | undefined;
    if (requestedPrimaryDeliverableId !== undefined) {
      if (requestedPrimaryDeliverableId === null || String(requestedPrimaryDeliverableId).trim() === "") {
        res.status(400).json({ error: "deliverableId cannot be empty" });
        return;
      }
      const nextDeliverableId = String(requestedPrimaryDeliverableId).trim();
      const targetDeliverable = await prisma.deliverable.findFirst({
        where: { id: nextDeliverableId, companyId: req.user.companyId },
      });
      if (!targetDeliverable) {
        res.status(400).json({ error: "Deliverable not found" });
        return;
      }
      if (targetDeliverable.projectId !== existing.projectId) {
        res.status(400).json({ error: "Deliverable must belong to the same project as the activity" });
        return;
      }
      if (targetDeliverable.fragnetId == null) {
        const ctx = await ensureProjectLevelActivityContext(existing.projectId, req.user.companyId);
        await prisma.deliverable.update({
          where: { id: targetDeliverable.id },
          data: { fragnetId: ctx.fragnet.id },
        });
        targetFragnetId = ctx.fragnet.id;
        targetStandardId = ctx.standard.id;
      } else {
        targetFragnetId = targetDeliverable.fragnetId;
        const targetFragnet = await prisma.fragnet.findFirst({
          where: { id: targetFragnetId, companyId: req.user.companyId },
          select: { standardId: true },
        });
        targetStandardId = targetFragnet?.standardId ?? null;
      }

      if (targetFragnetId !== existing.fragnetId) {
        const dependencyCount = await prisma.relationship.count({
          where: {
            companyId: req.user.companyId,
            OR: [{ predecessorActivityId: id }, { successorActivityId: id }],
          },
        });
        if (dependencyCount > 0) {
          res.status(409).json({
            error: "Cannot move an activity to a different fragnet while it has logic relationships. Remove the links first.",
          });
          return;
        }
      }
      resolvedDeliverableId = nextDeliverableId;
    }

    const primaryDeliverableId = resolvedDeliverableId ?? existing.deliverableId;
    const resolvedLinkedDeliverables = await resolveLinkedDeliverableIds({
      companyId: req.user.companyId,
      projectId: existing.projectId,
      fragnetId: targetFragnetId,
      primaryDeliverableId,
      deliverableIds: Array.isArray(deliverableIdsRaw)
        ? deliverableIdsRaw
        : existing.deliverableLinks.map((link) => link.deliverableId),
    });
    if (!resolvedLinkedDeliverables.ok) {
      res.status(resolvedLinkedDeliverables.status).json({ error: resolvedLinkedDeliverables.error });
      return;
    }

    if (assuranceNoteIdTrimmed !== undefined && assuranceNoteIdTrimmed !== null) {
      const note = (await prisma.assuranceNote.findFirst({
        where: { id: assuranceNoteIdTrimmed, companyId: req.user.companyId },
      })) as { id: string; standardId: string; projectId: string } | null;
      if (!note || !targetStandardId || note.standardId !== targetStandardId) {
        res.status(400).json({ error: "Assurance note must belong to the same standard as the activity context" });
        return;
      }
      if (note.projectId !== existing.projectId) {
        res.status(400).json({ error: "Assurance note must belong to the same project as the activity" });
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

    let resolvedCodeUpdate: string | undefined;
    if (activityCode !== undefined && String(activityCode).trim() !== "") {
      const deliverableForCode = await prisma.deliverable.findFirst({
        where: {
          id: resolvedDeliverableId ?? existing.deliverableId,
          companyId: req.user.companyId,
        },
      });
      if (deliverableForCode) {
        const codeCheck = await checkActivityCodeAvailability({
          projectId: deliverableForCode.projectId,
          companyId: req.user.companyId,
          fragnetId: targetFragnetId,
          userCode: String(activityCode),
          excludeActivityId: id,
        });
        if (!codeCheck.available || !codeCheck.normalizedCode) {
          res.status(400).json({
            error: codeCheck.message,
            suggestedCode: codeCheck.suggestedCode ?? undefined,
          });
          return;
        }
        resolvedCodeUpdate = codeCheck.normalizedCode;
      }
    }

    const updateData = {
      ...(targetFragnetId !== existing.fragnetId && { fragnetId: targetFragnetId }),
      ...(resolvedCodeUpdate !== undefined && { activityCode: resolvedCodeUpdate }),
      ...(name !== undefined && { name: String(name).trim() }),
      ...(resolvedDeliverableId !== undefined && { deliverableId: primaryDeliverableId }),
      ...(bestDurationRaw !== undefined && { bestDuration: parseDuration(bestDurationRaw)! }),
      ...(likelyDurationRaw !== undefined && { likelyDuration: parseDuration(likelyDurationRaw)! }),
      ...(assuranceNoteId !== undefined && { assuranceNoteId: assuranceNoteIdTrimmed ?? null }),
      ...(assignedUpdate !== undefined && { assignedResources: assignedUpdate }),
      ...(isSharedAcrossDeliverables !== undefined && {
        isSharedAcrossDeliverables: Boolean(isSharedAcrossDeliverables),
      }),
    };
    // Axios omits undefined JSON keys; the client may send only activityCodeByTypeId. Prisma rejects update({ data: {} }).
    const activity =
      Object.keys(updateData).length > 0
        ? await prisma.activity.update({
            where: { id },
            data: updateData,
          })
        : await prisma.activity.findFirstOrThrow({
            where: { id, companyId: req.user.companyId },
          });
    if (activityCodeByTypeId !== undefined) {
      try {
        await replaceActivityCodeAssignmentsForActivity({
          companyId: req.user.companyId,
          activityId: id,
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

    const targetIsShared =
      isSharedAcrossDeliverables === undefined
        ? existing.isSharedAcrossDeliverables
        : Boolean(isSharedAcrossDeliverables);
    if (targetIsShared) {
      await syncActivityDeliverableLinks({
        activityId: id,
        primaryDeliverableId,
        deliverableIds: resolvedLinkedDeliverables.deliverableIds,
        projectId: existing.projectId,
        companyId: req.user.companyId,
      });
    }
    if (targetIsShared) {
      await bootstrapSharedActivityRelationshipsForFragnet({
        fragnetId: targetFragnetId,
        companyId: req.user.companyId,
      });
    }

    const activityOut = await prisma.activity.findFirstOrThrow({
      where: { id: activity.id, companyId: req.user.companyId },
      include: activityInclude,
    });
    await auditUpdateIfChanged({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "UPDATE_ACTIVITY",
      entity: "Activity",
      entityId: id,
      before: existing as any,
      after: activity as any,
      fields: ["name", "deliverableId", "bestDuration", "likelyDuration", "assuranceNoteId", "assignedResources", "isSharedAcrossDeliverables"],
    });
    await recalculateProjectScheduleAfterMutation(existing.projectId, req.user.companyId);
    await captureLiveActivitySnapshot(existing.projectId, req.user.companyId, req.user.id, "activity.update");
    res.json(serializeLinkedDeliverables(activityOut));
  } catch (err) {
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity" });
  }
}

export async function bulkRemove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const body = req.body as { ids?: unknown };
    const rawIds = Array.isArray(body?.ids) ? body.ids : [];
    const activityIds = [...new Set(rawIds.filter((id): id is string => typeof id === "string" && id.length > 0))];
    if (activityIds.length === 0) {
      res.status(400).json({ error: "ids must be a non-empty array of activity ids" });
      return;
    }

    const activities = await prisma.activity.findMany({
      where: { id: { in: activityIds }, companyId: req.user.companyId },
      select: {
        id: true,
        projectId: true,
        status: true,
        fragnetId: true,
        deliverableId: true,
        isSharedAcrossDeliverables: true,
      },
    });

    const byId = new Map(activities.map((a) => [a.id, a]));
    const failed: { id: string; error: string }[] = [];
    for (const id of activityIds) {
      if (!byId.has(id)) failed.push({ id, error: "Activity not found" });
    }

    const projectIds = new Set(activities.map((a) => a.projectId));
    if (projectIds.size > 1) {
      res.status(400).json({
        error: "All activities must belong to the same project",
        deleted: [] as string[],
        failed: activityIds.map((id) => ({
          id,
          error: "Bulk delete requires activities from a single project",
        })),
      });
      return;
    }

    if (projectIds.size === 0) {
      res.json({ deleted: [], failed });
      return;
    }

    const projectId = [...projectIds][0]!;
    const membership = await requireProjectAccess(projectId, req.user);
    const role = membership.role as ProjectRole;

    const deleted: string[] = [];
    const fragnetIds = new Set<string>();
    const deliverableIds = new Set<string>();

    const dependencyRows = await prisma.relationship.findMany({
      where: {
        companyId: req.user.companyId,
        OR: [
          { predecessorActivityId: { in: activityIds } },
          { successorActivityId: { in: activityIds } },
        ],
      },
      select: { predecessorActivityId: true, successorActivityId: true },
    });
    const dependencyCountByActivity = new Map<string, number>();
    const activityIdSet = new Set(activityIds);
    for (const row of dependencyRows) {
      for (const linkedId of [row.predecessorActivityId, row.successorActivityId]) {
        if (!activityIdSet.has(linkedId)) continue;
        dependencyCountByActivity.set(linkedId, (dependencyCountByActivity.get(linkedId) ?? 0) + 1);
      }
    }

    const idsToDelete: string[] = [];
    for (const id of activityIds) {
      const existing = byId.get(id);
      if (!existing) continue;

      try {
        requirePermission(role, "activity", "delete", {
          status: existing.status,
          hasDependencies: (dependencyCountByActivity.get(id) ?? 0) > 0,
        });
        idsToDelete.push(id);
      } catch (err) {
        const status =
          err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) : undefined;
        const message =
          status === 409 || status === 403
            ? (err as Error).message || "Action not allowed"
            : isPrismaForeignKeyViolation(err)
              ? "Invalid cross-company reference"
              : "Failed to delete activity";
        failed.push({ id, error: message });
      }
    }

    if (idsToDelete.length > 0) {
      const deleteResult = await prisma.activity.deleteMany({
        where: { id: { in: idsToDelete }, companyId: req.user.companyId },
      });
      if (deleteResult.count > 0) {
        for (const id of idsToDelete) {
          const existing = byId.get(id);
          if (!existing) continue;
          deleted.push(id);
          noteActivityDeleteLinkageTarget(existing, fragnetIds, deliverableIds);
        }
        await auditLogMany(
          deleted.map((id) => ({
            userId: req.user!.id,
            companyId: req.user!.companyId,
            projectId,
            action: "DELETE_ACTIVITY",
            entity: "Activity",
            entityId: id,
          }))
        );
      }
    }

    if (deleted.length > 0) {
      await applyActivityDeleteSideEffects({
        companyId: req.user.companyId,
        projectId,
        fragnetIds,
        deliverableIds,
      });
      await captureLiveActivitySnapshot(projectId, req.user.companyId, req.user.id, "activity.bulkRemove");
    }

    res.json({ deleted, failed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to bulk delete activities" });
  }
}

export async function remove(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params;
    const existing = (await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
      select: {
        id: true,
        projectId: true,
        status: true,
        fragnetId: true,
        deliverableId: true,
        isSharedAcrossDeliverables: true,
      },
    })) as {
      id: string;
      projectId: string;
      status: string;
      fragnetId: string;
      deliverableId: string | null;
      isSharedAcrossDeliverables: boolean;
    } | null;
    if (!existing) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const membership = await requireProjectAccess(existing.projectId, req.user);
    const dependencyCount = await prisma.relationship.count({
      where: {
        companyId: req.user.companyId,
        OR: [{ predecessorActivityId: id }, { successorActivityId: id }],
      },
    });
    requirePermission(membership.role, "activity", "delete", {
      status: existing.status,
      hasDependencies: dependencyCount > 0,
    });
    await prisma.activity.delete({ where: { id } });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: existing.projectId,
      action: "DELETE_ACTIVITY",
      entity: "Activity",
      entityId: id,
    });

    const fragnetIds = new Set<string>();
    const deliverableIds = new Set<string>();
    noteActivityDeleteLinkageTarget(existing, fragnetIds, deliverableIds);
    await applyActivityDeleteSideEffects({
      companyId: req.user.companyId,
      projectId: existing.projectId,
      fragnetIds,
      deliverableIds,
    });
    await captureLiveActivitySnapshot(existing.projectId, req.user.companyId, req.user.id, "activity.remove");
    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : undefined;
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    if (isPrismaForeignKeyViolation(err)) {
      res.status(400).json({ error: "Invalid cross-company reference" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete activity" });
  }
}

export async function updateStatus(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { status } = req.body as { status?: string };
    const nextStatus = status != null ? String(status).trim() : "";
    if (nextStatus !== "DRAFT" && nextStatus !== "ACTIVE" && nextStatus !== "LOCKED") {
      res.status(400).json({ error: "status must be DRAFT, ACTIVE, or LOCKED" });
      return;
    }

    const { updated } = await transitionActivityStatus({
      activityId: id,
      nextStatus: nextStatus as any,
      actor: req.user,
    });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : undefined;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update activity status" });
  }
}

export async function getVersions(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const versions = await getActivityVersions(id, req.user);
    res.json({ versions });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load activity versions" });
  }
}

export async function rollback(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { targetVersion } = req.body as { targetVersion?: number };
    const n = Number(targetVersion);
    if (!Number.isFinite(n)) {
      res.status(400).json({ error: "targetVersion is required" });
      return;
    }

    const result = await rollbackActivityToVersion({
      activityId: id,
      targetVersion: n,
      actor: req.user,
    });
    res.json(result);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) {
      res.status(400).json({ error: (err as Error).message || "Invalid targetVersion" });
      return;
    }
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 404) {
      res.status(404).json({ error: (err as Error).message || "Activity not found" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to rollback activity" });
  }
}

export async function submit(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "submit", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to submit activity" });
  }
}

export async function approve(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "approve", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to approve activity" });
  }
}

export async function reject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const { comment } = req.body as { comment?: string | null };
    const { updated } = await changeApprovalState({ activityId: id, action: "reject", actor: req.user, comment });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 400) return void res.status(400).json({ error: (err as Error).message || "Invalid state transition" });
    if (status === 403) return void res.status(403).json({ error: (err as Error).message || "Forbidden" });
    if (status === 404) return void res.status(404).json({ error: (err as Error).message || "Activity not found" });
    if (status === 409) return void res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
    console.error(err);
    res.status(500).json({ error: "Failed to reject activity" });
  }
}

/** PATCH /activities/:id/detach-from-template — stop syncing with fragnet template. */
export async function detachFromTemplate(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id } = req.params as { id: string };
    const activity = await prisma.activity.findFirst({
      where: { id, companyId: req.user.companyId },
    });
    if (!activity) {
      res.status(404).json({ error: "Activity not found" });
      return;
    }
    const membership = await requireProjectAccess(activity.projectId, req.user);
    requirePermission(membership.role, "activity", "update");
    await detachActivityFromTemplate(id, req.user.companyId);
    const updated = await prisma.activity.findFirstOrThrow({
      where: { id, companyId: req.user.companyId },
      include: activityInclude,
    });
    res.json(serializeLinkedDeliverables(updated));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to detach activity from template" });
  }
}
