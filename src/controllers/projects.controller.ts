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
    console.error(err);
    res.status(500).json({ error: "Failed to create project" });
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

