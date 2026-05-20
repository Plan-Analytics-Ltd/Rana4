import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";

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

type FullDataActivityRel = { activityCode: string; relationshipType: "FS" | "SS" | "FF" | "SF"; lag: number };
type FullDataActivity = {
  id: string;
  activityCode: string;
  name: string;
  bestDuration: number;
  likelyDuration: number;
  assignedResources: unknown;
  relationships: { predecessors: FullDataActivityRel[]; successors: FullDataActivityRel[] };
};
type FullDataDeliverable = { id: string; name: string; activities: FullDataActivity[] };
type FullDataFragnet = {
  id: string;
  name: string;
  activityTemplateCount: number;
  deliverables: FullDataDeliverable[];
};

/** GET /projects/:id/full-data — nested view for read-only project viewer UI. */
export async function getFullData(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { id: projectId } = req.params as { id: string };
    const membership = await requireProjectAccess(projectId, req.user, { adminOverride: true });
    requirePermission(membership.role, "project", "read");

    const fragnets = await prisma.fragnet.findMany({
      where: { projectId, companyId: req.user.companyId },
      orderBy: { createdAt: "asc" },
      include: {
        deliverables: {
          where: { companyId: req.user.companyId },
          orderBy: { createdAt: "asc" },
          include: {
            activities: {
              where: { companyId: req.user.companyId },
              orderBy: [{ activityCode: "asc" }, { id: "asc" }],
              select: {
                id: true,
                activityCode: true,
                name: true,
                bestDuration: true,
                likelyDuration: true,
                assignedResources: true,
                fragnetId: true,
                isInherited: true,
                templateActivityId: true,
                detachedFromTemplate: true,
              },
            },
          },
        },
      },
    });

    const fragnetIds = fragnets.map((f) => f.id);
    const templateCounts = await prisma.fragnetActivityTemplate.groupBy({
      by: ["fragnetId"],
      where: { companyId: req.user.companyId, fragnetId: { in: fragnetIds } },
      _count: { _all: true },
    });
    const templateCountByFragnet = new Map(templateCounts.map((t) => [t.fragnetId, t._count._all]));
    const relationships = await prisma.relationship.findMany({
      where: { companyId: req.user.companyId, projectId, fragnetId: { in: fragnetIds } },
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
    for (const f of fragnets) {
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

    const out: { fragnets: FullDataFragnet[] } = {
      fragnets: fragnets.map((f) => ({
        id: f.id,
        name: f.name,
        activityTemplateCount: templateCountByFragnet.get(f.id) ?? 0,
        deliverables: f.deliverables.map((d) => ({
          id: d.id,
          name: d.name,
          activities: d.activities.map((a) => ({
            id: a.id,
            activityCode: a.activityCode,
            name: a.name,
            bestDuration: a.bestDuration,
            likelyDuration: a.likelyDuration,
            assignedResources: a.assignedResources,
            isInherited: a.isInherited,
            templateActivityId: a.templateActivityId,
            detachedFromTemplate: a.detachedFromTemplate,
            relationships: {
              predecessors: (predecessorsByActivityId.get(a.id) ?? []).sort((x, y) => x.activityCode.localeCompare(y.activityCode)),
              successors: (successorsByActivityId.get(a.id) ?? []).sort((x, y) => x.activityCode.localeCompare(y.activityCode)),
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

