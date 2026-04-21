import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { runWithAuthContextAsync } from "../utils/requestContext.js";

async function firstProjectId(companyId: string): Promise<string | null> {
  const p = await prisma.project.findFirst({
    where: { companyId },
    orderBy: { name: "asc" },
    select: { id: true },
  });
  return p?.id ?? null;
}

async function auditCompanyAction(
  actorId: string,
  companyId: string,
  action: string,
  entity: string,
  entityId: string,
  details?: unknown
): Promise<void> {
  const projectId = await firstProjectId(companyId);
  if (!projectId) return;
  await runWithAuthContextAsync({ userId: actorId, companyId }, async () => {
    await auditLog({
      userId: actorId,
      companyId,
      projectId,
      action,
      entity,
      entityId,
      details,
    });
  });
}

export async function listAdminRequests(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await prisma.adminRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            company: { select: { id: true, name: true } },
          },
        },
      },
    });
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        user: { email: r.user.email, companyName: r.user.company.name },
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list admin requests" });
  }
}

export async function approveAdminRequest(req: AuthRequest, res: Response): Promise<void> {
  const id = String((req.params as { id?: string }).id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.adminRequest.findFirst({
        where: { id, status: "PENDING" },
        include: { user: true },
      });
      if (!row) return { ok: false as const };
      await tx.user.update({
        where: { id: row.userId },
        data: { role: "ADMIN" },
      });
      await tx.adminRequest.update({
        where: { id: row.id },
        data: { status: "APPROVED" },
      });
      return { ok: true as const };
    });
    if (!result.ok) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve request" });
  }
}

export async function rejectAdminRequest(req: AuthRequest, res: Response): Promise<void> {
  const id = String((req.params as { id?: string }).id ?? "").trim();
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const row = await tx.adminRequest.findFirst({
        where: { id, status: "PENDING" },
      });
      if (!row) return { ok: false as const };
      await tx.adminRequest.update({
        where: { id: row.id },
        data: { status: "REJECTED" },
      });
      return { ok: true as const };
    });
    if (!result.ok) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject request" });
  }
}

export async function listCompanies(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await prisma.company.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        _count: { select: { users: true } },
      },
    });
    res.json({
      companies: rows.map((c) => ({
        id: c.id,
        name: c.name,
        userCount: c._count.users,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list companies" });
  }
}

export async function listUsers(_req: AuthRequest, res: Response): Promise<void> {
  try {
    const rows = await prisma.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        email: true,
        role: true,
        company: { select: { name: true } },
      },
    });
    res.json({
      users: rows.map((u) => ({
        id: u.id,
        email: u.email,
        role: u.role,
        companyName: u.company.name,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list users" });
  }
}

export async function demoteUserFromCompanyAdmin(req: AuthRequest, res: Response): Promise<void> {
  const id = String((req.params as { id?: string }).id ?? "").trim();
  const { role } = req.body as { role?: "EDITOR" | "VIEWER" };
  const nextRole = role === "EDITOR" || role === "VIEWER" ? role : "";
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  if (!nextRole) {
    res.status(400).json({ error: "role must be EDITOR or VIEWER" });
    return;
  }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, companyId: true, email: true },
      });
      if (!target) return { kind: "not_found" } as const;
      if (target.role !== "ADMIN") return { kind: "not_admin" } as const;

      const adminCount = await tx.user.count({
        where: { companyId: target.companyId, role: "ADMIN" },
      });
      if (adminCount <= 1) return { kind: "last_admin" } as const;

      await tx.user.update({
        where: { id: target.id },
        data: { role: nextRole },
      });
      return { kind: "ok", companyId: target.companyId, from: target.role, to: nextRole } as const;
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (result.kind === "not_admin") {
      res.status(409).json({ error: "User is not an admin" });
      return;
    }
    if (result.kind === "last_admin") {
      res.status(409).json({ error: "Cannot demote the last company admin" });
      return;
    }

    if (req.user) {
      await auditCompanyAction(req.user.id, result.companyId, "DEV_DEMOTE_COMPANY_ADMIN", "User", id, {
        from: result.from,
        to: result.to,
        userId: id,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to demote user" });
  }
}

export async function setUserRole(req: AuthRequest, res: Response): Promise<void> {
  const id = String((req.params as { id?: string }).id ?? "").trim();
  const { role } = req.body as { role?: "ADMIN" | "EDITOR" | "VIEWER" };
  const nextRole = role === "ADMIN" || role === "EDITOR" || role === "VIEWER" ? role : "";
  if (!id) { res.status(400).json({ error: "id is required" }); return; }
  if (!nextRole) { res.status(400).json({ error: "role must be ADMIN, EDITOR, or VIEWER" }); return; }
  try {
    const result = await prisma.$transaction(async (tx) => {
      const target = await tx.user.findUnique({
        where: { id },
        select: { id: true, role: true, companyId: true },
      });
      if (!target) return { kind: "not_found" } as const;
      if (target.role === nextRole) return { kind: "no_change", role: target.role } as const;
      // Safety: never demote the last company admin.
      if (target.role === "ADMIN" && nextRole !== "ADMIN") {
        const adminCount = await tx.user.count({ where: { companyId: target.companyId, role: "ADMIN" } });
        if (adminCount <= 1) return { kind: "last_admin" } as const;
      }
      await tx.user.update({
        where: { id: target.id },
        data: { role: nextRole },
      });
      return { kind: "ok", companyId: target.companyId, from: target.role, to: nextRole } as const;
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (result.kind === "no_change") {
      res.json({ ok: true });
      return;
    }
    if (result.kind === "last_admin") {
      res.status(409).json({ error: "Cannot demote the last company admin" });
      return;
    }

    if (req.user) {
      await auditCompanyAction(req.user.id, result.companyId, "DEV_SET_USER_ROLE", "User", id, {
        from: result.from,
        to: result.to,
        userId: id,
      });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update user role" });
  }
}
