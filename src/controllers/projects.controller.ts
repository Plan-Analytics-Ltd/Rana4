import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";
import {
  compareActivityCodes,
  parseActivityCode,
  suggestNextActivityCode,
  checkActivityCodeAvailability,
} from "../services/activityCodeSequence.service.js";
import { runWithAuthContextAsync } from "../utils/requestContext.js";
import {
  PROJECT_LEVEL_FRAGNET_NAME,
  PROJECT_LEVEL_STANDARD_NAME,
} from "../services/projectLevelActivityContext.service.js";

async function isLastAdmin(projectId: string, companyId: string): Promise<boolean> {
  const count = await prisma.projectMember.count({
    where: { projectId, role: "ADMIN", project: { companyId } },
  });
  return count === 1;
}

export async function listMyProjects(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Company admins can see all projects; others only those they belong to.
    if (req.user.role === "ADMIN") {
      const projects = await prisma.project.findMany({
        where: { companyId: req.user.companyId },
        orderBy: { name: "asc" },
      });
      res.json(projects.map((p) => ({ ...p, myRole: "ADMIN" })));
      return;
    }

    const memberships = await prisma.projectMember.findMany({
      where: { userId: req.user.id, project: { companyId: req.user.companyId } },
      select: { project: true, role: true },
      orderBy: { project: { name: "asc" } },
    });
    res.json(memberships.map((m) => ({ ...m.project, myRole: m.role })));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load projects" });
  }
}

export async function createProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    // Company-level project management: allow ADMIN/EDITOR (block VIEWER).
    requirePermission(req.user.role as any, "project", "create");

    const { name } = req.body as { name?: string };
    const nameStr = name != null ? String(name).trim() : "";
    if (!nameStr) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const project = await prisma.project.create({
      data: { name: nameStr, companyId: req.user.companyId },
    });

    // Creator becomes project admin regardless of company role.
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: req.user.id, role: "ADMIN" },
    });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: project.id,
      action: "CREATE_PROJECT",
      entity: "Project",
      entityId: project.id,
    });

    res.status(201).json(project);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
  }
}

export async function updateProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const { name } = req.body as { name?: string };
    const nameStr = name != null ? String(name).trim() : "";
    if (!nameStr) {
      res.status(400).json({ error: "name is required" });
      return;
    }

    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "update");

    const result = await prisma.project.updateMany({
      where: { id: projectId, companyId: req.user.companyId },
      data: { name: nameStr.slice(0, 255) },
    });
    if (result.count !== 1) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "UPDATE_PROJECT",
      entity: "Project",
      entityId: projectId,
      details: { name: nameStr.slice(0, 255) },
    });

    const updated = await prisma.project.findFirst({ where: { id: projectId, companyId: req.user.companyId } });
    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update project" });
  }
}

export async function deleteProject(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const forceRaw = (req.query as any)?.force;
    const force =
      forceRaw === true ||
      String(forceRaw ?? "")
        .trim()
        .toLowerCase() === "true" ||
      String(forceRaw ?? "")
        .trim()
        .toLowerCase() === "1";

    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "delete");

    const [standards, fragnets, deliverables, activities, relationships, assuranceNotes, auditLogs, projectMembers] =
      await Promise.all([
      prisma.standard.count({ where: { projectId } }),
      prisma.fragnet.count({ where: { projectId } }),
      prisma.deliverable.count({ where: { projectId } }),
      prisma.activity.count({ where: { projectId } }),
      prisma.relationship.count({ where: { projectId } }),
      prisma.assuranceNote.count({ where: { projectId } }),
      prisma.auditLog.count({ where: { projectId } }),
      prisma.projectMember.count({ where: { projectId } }),
    ]);
    const total =
      standards + fragnets + deliverables + activities + relationships + assuranceNotes + auditLogs + projectMembers;
    if (total > 0 && !force) {
      res.status(409).json({
        error: "Project is not empty",
        needsConfirmation: true,
        message: "Deleting this project will permanently delete everything inside it. Re-try with ?force=true to confirm.",
        counts: {
          standards,
          fragnets,
          deliverables,
          activities,
          relationships,
          assuranceNotes,
          auditLogs,
          projectMembers,
          total,
        },
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      // NOTE: Project foreign keys are NoAction in schema; we must delete dependents explicitly.
      // Order matters due to FK constraints (relationships -> activities -> deliverables/fragnets -> standards, etc).
      await tx.relationship.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.activity.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.deliverable.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.fragnet.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.assuranceNote.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.standard.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.auditLog.deleteMany({ where: { projectId, companyId: req.user!.companyId } });
      await tx.projectMember.deleteMany({ where: { projectId, project: { companyId: req.user!.companyId } } });
      await tx.project.deleteMany({ where: { id: projectId, companyId: req.user!.companyId } });
    });

    // Use any remaining project as audit scope (or skip if none).
    const p = await prisma.project.findFirst({
      where: { companyId: req.user.companyId },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (p) {
      await auditLog({
        userId: req.user.id,
        companyId: req.user.companyId,
        projectId: p.id,
        action: "DELETE_PROJECT",
        entity: "Project",
        entityId: projectId,
      });
    }

    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to delete project" });
  }
}

type FullDataActivityRel = {
  activityCode: string;
  /** Set when predecessor is a deliverable (deliverable→activity link). */
  deliverableName?: string;
  relationshipType: "FS" | "SS" | "FF" | "SF";
  lag: number;
};
type FullDataActivity = {
  id: string;
  activityCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  p6TaskType?: string | null;
  assignedResources: unknown;
  isSharedAcrossDeliverables?: boolean;
  isInherited?: boolean;
  templateActivityId?: string | null;
  detachedFromTemplate?: boolean;
  linkedDeliverables?: Array<{ id: string; name: string; isPrimary?: boolean }>;
  relationships: { predecessors: FullDataActivityRel[]; successors: FullDataActivityRel[] };
};
type FullDataDeliverableRel = {
  deliverableName: string;
  /** Set when successor is an activity (deliverable→activity link). */
  activityCode?: string;
  relationshipType: string;
  lag: number;
};
type FullDataDeliverable = {
  id: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  relationships: { predecessors: FullDataDeliverableRel[]; successors: FullDataDeliverableRel[] };
  activities: FullDataActivity[];
};
type FullDataFragnet = {
  id: string;
  name: string;
  activityTemplateCount: number;
  deliverables: FullDataDeliverable[];
};

const PROJECT_UNASSIGNED_FRAGNET_ID = "__project_unassigned__";
const PROJECT_UNASSIGNED_FRAGNET_NAME = "Project-level deliverables";

/** GET /projects/:id/full-data — nested view for read-only project viewer UI. */
export async function getDashboardSummary(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const companyId = req.user.companyId;
    const whereProject = { projectId, companyId };

    const [deliverablesCount, activitiesCount, deliverablesMissingDuration, lastSnapshot] =
      await Promise.all([
        prisma.deliverable.count({ where: whereProject }),
        prisma.activity.count({ where: whereProject }),
        prisma.deliverable.count({
          where: {
            ...whereProject,
            bestDuration: { lte: 0 },
            likelyDuration: { lte: 0 },
          },
        }),
        prisma.programmeSnapshot.findFirst({
          where: whereProject,
          orderBy: { importedAt: "desc" },
          select: { importedAt: true, sourceType: true, label: true },
        }),
      ]);

    res.json({
      deliverablesCount,
      activitiesCount,
      deliverablesMissingDuration,
      lastImport: lastSnapshot
        ? {
            importedAt: lastSnapshot.importedAt.toISOString(),
            sourceType: lastSnapshot.sourceType,
            label: lastSnapshot.label,
          }
        : null,
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load dashboard summary" });
  }
}

export async function getFullData(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const { materializeProjectDeliverablesInOrder } = await import(
      "../services/fragnetActivityTemplate.service.js"
    );
    await runWithAuthContextAsync(
      { userId: req.user.id, companyId: req.user.companyId },
      async () => materializeProjectDeliverablesInOrder(projectId, req.user!.companyId)
    );

    const deliverableSelect: any = {
      id: true,
      name: true,
      classification: true,
      bestDuration: true,
      likelyDuration: true,
    };

    const allFragnets: any[] = await prisma.fragnet.findMany({
      where: { projectId, companyId: req.user.companyId },
      orderBy: { createdAt: "asc" },
      include: {
        deliverables: {
          where: { companyId: req.user.companyId },
          orderBy: { createdAt: "asc" },
          select: deliverableSelect,
        },
      },
    });
    const projectLevelFragnet = allFragnets.find((fragnet) => String(fragnet.name) === PROJECT_LEVEL_FRAGNET_NAME);
    const fragnets = allFragnets.filter((fragnet) => String(fragnet.name) !== PROJECT_LEVEL_FRAGNET_NAME);
    const unassignedDeliverables: any[] = await prisma.deliverable.findMany({
      where: { projectId, companyId: req.user.companyId, fragnetId: null },
      orderBy: { createdAt: "asc" },
      select: deliverableSelect,
    });

    const projectActivities: any[] = await prisma.activity.findMany({
      where: { companyId: req.user.companyId, projectId },
      orderBy: [{ activityCode: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        activityCode: true,
        name: true,
        bestDuration: true,
        likelyDuration: true,
        p6TaskType: true,
        assignedResources: true,
        fragnetId: true,
        deliverableId: true,
        isSharedAcrossDeliverables: true,
        isInherited: true,
        templateActivityId: true,
        detachedFromTemplate: true,
        deliverableLinks: {
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
          select: {
            isPrimary: true,
            deliverable: { select: { id: true, name: true } },
          },
        },
      },
    });

    const activitiesByDeliverableId = new Map<string, any[]>();
    for (const a of projectActivities) {
      const linkDeliverableIds = (a.deliverableLinks ?? [])
        .map((l: any) => String(l.deliverable?.id ?? ""))
        .filter(Boolean);

      // Shared activities: only explicit junction links (never scalar deliverableId fallback).
      if (a.isSharedAcrossDeliverables) {
        for (const deliverableId of linkDeliverableIds) {
          const list = activitiesByDeliverableId.get(deliverableId) ?? [];
          list.push(a);
          activitiesByDeliverableId.set(deliverableId, list);
        }
        continue;
      }

      // Non-shared: scalar deliverable owner only (never junction membership).
      if (a.deliverableId) {
        const deliverableId = String(a.deliverableId);
        const list = activitiesByDeliverableId.get(deliverableId) ?? [];
        list.push(a);
        activitiesByDeliverableId.set(deliverableId, list);
      }
    }

    const fragnetIds = fragnets.map((f) => f.id);
    const relationshipFragnetIds = [
      ...fragnetIds,
      ...(projectLevelFragnet ? [String(projectLevelFragnet.id)] : []),
    ];
    const deliverableRelationships = await prisma.deliverableRelationship.findMany({
      where: { companyId: req.user.companyId, projectId, fragnetId: { in: relationshipFragnetIds } },
      select: {
        fragnetId: true,
        predecessorDeliverableId: true,
        successorDeliverableId: true,
        relationshipType: true,
        lag: true,
      },
    });
    const deliverableActivityRelationships = await prisma.deliverableActivityRelationship.findMany({
      where: { companyId: req.user.companyId, projectId, fragnetId: { in: relationshipFragnetIds } },
      select: {
        predecessorDeliverableId: true,
        successorActivityId: true,
        relationshipType: true,
        lag: true,
      },
    });
    const activityToDeliverableRelationships = await prisma.activityToDeliverableRelationship.findMany({
      where: { companyId: req.user.companyId, projectId, fragnetId: { in: relationshipFragnetIds } },
      select: {
        predecessorActivityId: true,
        successorDeliverableId: true,
        relationshipType: true,
        lag: true,
      },
    });
    const templateCounts = await prisma.fragnetActivityTemplate.groupBy({
      by: ["fragnetId"],
      where: { companyId: req.user.companyId, fragnetId: { in: fragnetIds } },
      _count: { _all: true },
    });
    const templateCountByFragnet = new Map(templateCounts.map((t) => [t.fragnetId, t._count._all]));
    const projectLevelDeliverables: any[] = [
      ...((projectLevelFragnet?.deliverables ?? []) as any[]),
      ...unassignedDeliverables,
    ];
    const baseFragnets: FullDataFragnet[] = [
      ...fragnets.map((f) => ({
        id: String(f.id),
        name: String(f.name),
        activityTemplateCount: templateCountByFragnet.get(String(f.id)) ?? 0,
        deliverables: (f.deliverables ?? []).map((d: any) => ({
          id: String(d.id),
          name: String(d.name),
          bestDuration: Number(d.bestDuration ?? 1),
          likelyDuration: Number(d.likelyDuration ?? 1),
          relationships: { predecessors: [], successors: [] },
          activities: (activitiesByDeliverableId.get(String(d.id)) ?? []).map((a: any) => ({
            id: String(a.id),
            deliverableId: String(a.deliverableId ?? ""),
            activityCode: String(a.activityCode),
            name: String(a.name),
            bestDuration: Number(a.bestDuration ?? 1),
            likelyDuration: Number(a.likelyDuration ?? 1),
            p6TaskType: a.p6TaskType ?? null,
            assignedResources: a.assignedResources,
            isSharedAcrossDeliverables: Boolean(a.isSharedAcrossDeliverables),
            isInherited: Boolean(a.isInherited),
            templateActivityId: a.templateActivityId ?? null,
            detachedFromTemplate: Boolean(a.detachedFromTemplate),
            linkedDeliverables: (a.deliverableLinks ?? []).map((link: any) => ({
              id: String(link.deliverable.id),
              name: String(link.deliverable.name),
              isPrimary: Boolean(link.isPrimary),
            })),
            relationships: { predecessors: [], successors: [] },
          })),
        })),
      })),
      ...(projectLevelDeliverables.length > 0
        ? [
            {
              id: String(projectLevelFragnet?.id ?? PROJECT_UNASSIGNED_FRAGNET_ID),
              name: PROJECT_UNASSIGNED_FRAGNET_NAME,
              activityTemplateCount: 0,
              deliverables: projectLevelDeliverables.map((d: any) => ({
                id: String(d.id),
                name: String(d.name),
                bestDuration: Number(d.bestDuration ?? 1),
                likelyDuration: Number(d.likelyDuration ?? 1),
                relationships: { predecessors: [], successors: [] },
                activities: (activitiesByDeliverableId.get(String(d.id)) ?? []).map((a: any) => ({
                  id: String(a.id),
                  deliverableId: String(a.deliverableId ?? ""),
                  activityCode: String(a.activityCode),
                  name: String(a.name),
                  bestDuration: Number(a.bestDuration ?? 1),
                  likelyDuration: Number(a.likelyDuration ?? 1),
                  p6TaskType: a.p6TaskType ?? null,
                  assignedResources: a.assignedResources,
                  isSharedAcrossDeliverables: Boolean(a.isSharedAcrossDeliverables),
                  isInherited: Boolean(a.isInherited),
                  templateActivityId: a.templateActivityId ?? null,
                  detachedFromTemplate: Boolean(a.detachedFromTemplate),
                  linkedDeliverables: (a.deliverableLinks ?? []).map((link: any) => ({
                    id: String(link.deliverable.id),
                    name: String(link.deliverable.name),
                    isPrimary: Boolean(link.isPrimary),
                  })),
                  relationships: { predecessors: [], successors: [] },
                })),
              })),
            },
          ]
        : []),
    ];
    const relationships = await prisma.relationship.findMany({
      where: { companyId: req.user.companyId, projectId, fragnetId: { in: relationshipFragnetIds } },
      select: {
        fragnetId: true,
        predecessorActivityId: true,
        successorActivityId: true,
        relationshipType: true,
        lag: true,
      },
    });

    // Map activityId -> activityCode for relationship display
    const activityIdToCode = new Map<string, string>();
    for (const f of baseFragnets) {
      for (const d of f.deliverables) {
        for (const a of d.activities) {
          activityIdToCode.set(a.id, a.activityCode);
        }
      }
    }

    const predecessorsByActivityId = new Map<string, FullDataActivityRel[]>();
    const successorsByActivityId = new Map<string, FullDataActivityRel[]>();

    for (const r of relationships) {
      const predCode = activityIdToCode.get(r.predecessorActivityId) ?? r.predecessorActivityId;
      const succCode = activityIdToCode.get(r.successorActivityId) ?? r.successorActivityId;
      const rel: FullDataActivityRel = {
        activityCode: predCode,
        relationshipType: r.relationshipType as any,
        lag: r.lag,
      };
      const rel2: FullDataActivityRel = {
        activityCode: succCode,
        relationshipType: r.relationshipType as any,
        lag: r.lag,
      };

      // successor has predecessor entry
      const pArr = predecessorsByActivityId.get(r.successorActivityId) ?? [];
      pArr.push(rel);
      predecessorsByActivityId.set(r.successorActivityId, pArr);

      // predecessor has successor entry
      const sArr = successorsByActivityId.get(r.predecessorActivityId) ?? [];
      sArr.push(rel2);
      successorsByActivityId.set(r.predecessorActivityId, sArr);
    }

    const deliverableNameById = new Map<string, string>();
    for (const f of baseFragnets) {
      for (const d of f.deliverables) {
        deliverableNameById.set(d.id, d.name);
      }
    }
    const predecessorsByDeliverableId = new Map<string, FullDataDeliverableRel[]>();
    const successorsByDeliverableId = new Map<string, FullDataDeliverableRel[]>();
    for (const r of deliverableRelationships) {
      const predName = deliverableNameById.get(r.predecessorDeliverableId) ?? r.predecessorDeliverableId;
      const succName = deliverableNameById.get(r.successorDeliverableId) ?? r.successorDeliverableId;
      const predRel: FullDataDeliverableRel = {
        deliverableName: predName,
        relationshipType: r.relationshipType,
        lag: r.lag,
      };
      const succRel: FullDataDeliverableRel = {
        deliverableName: succName,
        relationshipType: r.relationshipType,
        lag: r.lag,
      };
      const pArr = predecessorsByDeliverableId.get(r.successorDeliverableId) ?? [];
      pArr.push(predRel);
      predecessorsByDeliverableId.set(r.successorDeliverableId, pArr);
      const sArr = successorsByDeliverableId.get(r.predecessorDeliverableId) ?? [];
      sArr.push(succRel);
      successorsByDeliverableId.set(r.predecessorDeliverableId, sArr);
    }

    for (const r of deliverableActivityRelationships) {
      const succCode = activityIdToCode.get(r.successorActivityId) ?? r.successorActivityId;
      const delName =
        deliverableNameById.get(r.predecessorDeliverableId) ?? r.predecessorDeliverableId;
      const toActivity: FullDataDeliverableRel = {
        deliverableName: delName,
        activityCode: succCode,
        relationshipType: r.relationshipType,
        lag: r.lag,
      };
      const sArr = successorsByDeliverableId.get(r.predecessorDeliverableId) ?? [];
      sArr.push(toActivity);
      successorsByDeliverableId.set(r.predecessorDeliverableId, sArr);

      const fromDeliverable: FullDataActivityRel = {
        activityCode: "",
        deliverableName: delName,
        relationshipType: r.relationshipType as FullDataActivityRel["relationshipType"],
        lag: r.lag,
      };
      const pArr = predecessorsByActivityId.get(r.successorActivityId) ?? [];
      pArr.push(fromDeliverable);
      predecessorsByActivityId.set(r.successorActivityId, pArr);
    }

    for (const r of activityToDeliverableRelationships) {
      const predCode = activityIdToCode.get(r.predecessorActivityId) ?? r.predecessorActivityId;
      const delName =
        deliverableNameById.get(r.successorDeliverableId) ?? r.successorDeliverableId;
      const toDeliverable: FullDataActivityRel = {
        activityCode: "",
        deliverableName: delName,
        relationshipType: r.relationshipType as FullDataActivityRel["relationshipType"],
        lag: r.lag,
      };
      const sArr = successorsByActivityId.get(r.predecessorActivityId) ?? [];
      sArr.push(toDeliverable);
      successorsByActivityId.set(r.predecessorActivityId, sArr);

      const fromActivity: FullDataDeliverableRel = {
        deliverableName: delName,
        activityCode: predCode,
        relationshipType: r.relationshipType,
        lag: r.lag,
      };
      const pArr = predecessorsByDeliverableId.get(r.successorDeliverableId) ?? [];
      pArr.push(fromActivity);
      predecessorsByDeliverableId.set(r.successorDeliverableId, pArr);
    }

    const sortDeliverablesByActivityOrder = <T extends { activities: { activityCode: string }[] }>(
      items: T[]
    ): T[] =>
      [...items]
        .map((d, index) => {
          let min = Number.POSITIVE_INFINITY;
          for (const a of d.activities) {
            const p = parseActivityCode(a.activityCode);
            if (p && p.number < min) min = p.number;
          }
          return { d, index, min };
        })
        .sort((a, b) => (a.min !== b.min ? a.min - b.min : a.index - b.index))
        .map((x) => x.d);

    const out: { fragnets: FullDataFragnet[] } = {
      fragnets: baseFragnets.map((f) => ({
        id: f.id,
        name: f.name,
        activityTemplateCount: f.activityTemplateCount,
        deliverables: sortDeliverablesByActivityOrder(f.deliverables).map((d) => ({
          id: d.id,
          name: d.name,
          bestDuration: d.bestDuration,
          likelyDuration: d.likelyDuration,
          relationships: {
            predecessors: (predecessorsByDeliverableId.get(d.id) ?? []).sort((x, y) =>
              x.deliverableName.localeCompare(y.deliverableName)
            ),
            successors: (successorsByDeliverableId.get(d.id) ?? []).sort((x, y) =>
              x.deliverableName.localeCompare(y.deliverableName)
            ),
          },
          activities: [...d.activities]
            .sort((a, b) => compareActivityCodes(a.activityCode, b.activityCode))
            .map((a) => ({
            id: a.id,
            activityCode: a.activityCode,
            name: a.name,
            bestDuration: a.bestDuration,
            likelyDuration: a.likelyDuration,
            p6TaskType: a.p6TaskType ?? null,
            assignedResources: a.assignedResources,
            isSharedAcrossDeliverables: a.isSharedAcrossDeliverables,
            isInherited: a.isInherited,
            templateActivityId: a.templateActivityId,
            detachedFromTemplate: a.detachedFromTemplate,
            linkedDeliverables: a.linkedDeliverables,
            relationships: {
              predecessors: (predecessorsByActivityId.get(a.id) ?? []).sort((x, y) =>
                compareActivityCodes(x.activityCode, y.activityCode)
              ),
              successors: (successorsByActivityId.get(a.id) ?? []).sort((x, y) =>
                compareActivityCodes(x.activityCode, y.activityCode)
              ),
            },
          })),
        })),
      })),
    };

    res.json(out);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load project data" });
  }
}

export async function addMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const { userId, role } = req.body as { userId?: string; role?: "ADMIN" | "EDITOR" | "VIEWER" };
    const userIdStr = userId != null ? String(userId).trim() : "";
    const roleVal = role === "ADMIN" || role === "EDITOR" || role === "VIEWER" ? role : "VIEWER";

    if (!userIdStr) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    // Member management is project-scoped; company ADMIN can still bypass membership check via helper.
    const actorMembership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(actorMembership.role, "projectMember", "create");

    const targetUser = await prisma.user.findFirst({
      where: { id: userIdStr, companyId: req.user.companyId },
      select: { id: true },
    });
    if (!targetUser) {
      res.status(400).json({ error: "User not found in this company" });
      return;
    }

    const membership = await prisma.projectMember.upsert({
      where: { userId_projectId: { userId: userIdStr, projectId } },
      create: { userId: userIdStr, projectId, role: roleVal },
      update: { role: roleVal },
    });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "ADD_PROJECT_MEMBER",
      entity: "Project",
      entityId: projectId,
    });

    res.status(201).json(membership);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to add project member" });
  }
}

export async function listMembers(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "projectMember", "read");

    const rows = await prisma.projectMember.findMany({
      where: { projectId, project: { companyId: req.user.companyId } },
      orderBy: [{ role: "asc" }, { user: { email: "asc" } }],
      select: {
        userId: true,
        projectId: true,
        role: true,
        user: { select: { email: true, name: true } },
      },
    });

    res.json({
      members: rows.map((r) => ({
        userId: r.userId,
        projectId: r.projectId,
        role: r.role,
        email: r.user.email,
        name: r.user.name,
      })),
    });
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to load project members" });
  }
}

export async function removeMember(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId, userId } = req.params as { id: string; userId: string };
    const userIdStr = userId != null ? String(userId).trim() : "";
    if (!userIdStr) {
      res.status(400).json({ error: "userId is required" });
      return;
    }

    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });

    const target = await prisma.projectMember.findFirst({
      where: { userId: userIdStr, projectId, project: { companyId: req.user.companyId } },
      select: { id: true, role: true },
    });

    const isLastAdmin =
      target?.role === "ADMIN"
        ? (await prisma.projectMember.count({
            where: { projectId, project: { companyId: req.user.companyId }, role: "ADMIN" },
          })) <= 1
        : false;
    requirePermission(membership.role, "projectMember", "delete", { isLastAdmin });

    await prisma.projectMember.deleteMany({
      where: { userId: userIdStr, projectId, project: { companyId: req.user.companyId } },
    });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "REMOVE_PROJECT_MEMBER",
      entity: "Project",
      entityId: projectId,
    });

    res.status(204).send();
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to remove project member" });
  }
}

export async function updateMemberRole(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId, userId } = req.params as { id: string; userId: string };
    const { role } = req.body as { role?: "ADMIN" | "EDITOR" | "VIEWER" };
    const userIdStr = userId != null ? String(userId).trim() : "";
    const roleVal = role === "ADMIN" || role === "EDITOR" || role === "VIEWER" ? role : "";
    if (!userIdStr) {
      res.status(400).json({ error: "userId is required" });
      return;
    }
    if (!roleVal) {
      res.status(400).json({ error: "role must be ADMIN, EDITOR, or VIEWER" });
      return;
    }

    // Rule 2 — prevent cross-project access (and ensure actor has project context)
    const actorMembership = await requireProjectAccess(projectId, req.user, { adminOverride: true });

    // Rule 3 — only project ADMIN can change roles
    requirePermission(actorMembership.role, "projectMember", "update");

    // Rule 0 — membership must exist
    const targetMembership = await prisma.projectMember.findFirst({
      where: { userId: userIdStr, projectId, project: { companyId: req.user.companyId } },
      select: { id: true, role: true, userId: true, projectId: true },
    });
    if (!targetMembership) {
      res.status(404).json({ error: "Project membership not found" });
      return;
    }

    // Rule 1 — prevent removing last admin
    if (targetMembership.role === "ADMIN" && roleVal !== "ADMIN") {
      const last = await isLastAdmin(projectId, req.user.companyId);
      if (last) {
        res.status(409).json({ error: "Cannot demote the last project admin" });
        return;
      }
    }

    if (targetMembership.role === roleVal) {
      res.json({ ...targetMembership, role: roleVal });
      return;
    }

    const fromRole = targetMembership.role;
    const result = await prisma.projectMember.updateMany({
      where: { id: targetMembership.id, project: { companyId: req.user.companyId } },
      data: { role: roleVal },
    });
    if (result.count !== 1) {
      res.status(404).json({ error: "Project membership not found" });
      return;
    }
    const updated = await prisma.projectMember.findFirst({
      where: { userId: userIdStr, projectId, project: { companyId: req.user.companyId } },
      select: { id: true, userId: true, projectId: true, role: true },
    });
    if (!updated) {
      res.status(404).json({ error: "Project membership not found" });
      return;
    }

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId,
      action: "UPDATE_PROJECT_MEMBER_ROLE",
      entity: "Project",
      entityId: projectId,
      details: { from: fromRole, to: roleVal, userId: userIdStr },
    });

    res.json(updated);
  } catch (err) {
    const status = err && typeof err === "object" && "status" in err ? Number((err as any).status) : 500;
    if (status === 403) {
      res.status(403).json({ error: (err as Error).message || "Forbidden" });
      return;
    }
    if (status === 409) {
      res.status(409).json({ error: (err as Error).message || "Action not allowed in current state" });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Failed to update project member role" });
  }
}

export async function getSuggestedActivityCode(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    await requireProjectAccess(projectId, req.user);
    const excludeActivityId =
      typeof req.query.excludeActivityId === "string" ? req.query.excludeActivityId.trim() : undefined;
    const code = await runWithAuthContextAsync(
      { userId: req.user.id, companyId: req.user.companyId },
      async () =>
        suggestNextActivityCode(projectId, req.user!.companyId, excludeActivityId || undefined)
    );
    res.json({ activityCode: code });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to suggest activity code" });
  }
}

export async function getActivityCodeAvailability(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const fragnetId = typeof req.query.fragnetId === "string" ? req.query.fragnetId.trim() : "";
    const excludeActivityId =
      typeof req.query.excludeActivityId === "string" ? req.query.excludeActivityId.trim() : undefined;

    if (!fragnetId) {
      res.status(400).json({ error: "fragnetId query parameter is required" });
      return;
    }

    await requireProjectAccess(projectId, req.user);

    const fragnet = await prisma.fragnet.findFirst({
      where: { id: fragnetId, projectId, companyId: req.user.companyId },
      select: { id: true },
    });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found on this project" });
      return;
    }

    const result = await runWithAuthContextAsync(
      { userId: req.user.id, companyId: req.user.companyId },
      async () =>
        checkActivityCodeAvailability({
          projectId,
          companyId: req.user!.companyId,
          fragnetId,
          userCode: code,
          excludeActivityId: excludeActivityId || undefined,
        })
    );
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to check activity code availability" });
  }
}

