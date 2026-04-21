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

function serializeRequest(r: {
  id: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function getMyRequest(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const latest = await prisma.adminRequest.findFirst({
      where: { userId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    if (!latest) {
      res.json({ request: null });
      return;
    }
    res.json({ request: serializeRequest(latest) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load request" });
  }
}

export async function createRequest(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  if (req.user.role === "ADMIN") {
    res.status(400).json({ error: "You already have company administrator access" });
    return;
  }
  try {
    const existing = await prisma.adminRequest.findFirst({
      where: { userId: req.user.id, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
    if (existing) {
      res.status(400).json({ error: "You already have a pending request" });
      return;
    }

    const created = await prisma.adminRequest.create({
      data: {
        userId: req.user.id,
        status: "PENDING",
      },
    });

    await auditCompanyAction(req.user.id, req.user.companyId, "ADMIN_REQUEST_CREATED", "AdminRequest", created.id);

    res.status(201).json({ request: serializeRequest(created) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create admin request" });
  }
}

export async function listPendingRequests(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const rows = await prisma.adminRequest.findMany({
      where: {
        status: "PENDING",
        user: { companyId: req.user.companyId },
      },
      orderBy: { createdAt: "asc" },
      include: {
        user: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        user: r.user,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to list requests" });
  }
}

export async function approveRequest(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
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
      if (!row || row.user.companyId !== req.user!.companyId) {
        return { ok: false as const, status: 404 as const };
      }
      await tx.user.update({
        where: { id: row.userId },
        data: { role: "ADMIN" },
      });
      await tx.adminRequest.update({
        where: { id: row.id },
        data: { status: "APPROVED" },
      });
      return { ok: true as const, targetUserId: row.userId, requestId: row.id };
    });

    if (!result.ok) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    await auditCompanyAction(req.user.id, req.user.companyId, "ADMIN_REQUEST_APPROVED", "AdminRequest", result.requestId, {
      targetUserId: result.targetUserId,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to approve request" });
  }
}

export async function rejectRequest(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
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
      if (!row || row.user.companyId !== req.user!.companyId) {
        return { ok: false as const };
      }
      await tx.adminRequest.update({
        where: { id: row.id },
        data: { status: "REJECTED" },
      });
      return { ok: true as const, requestId: row.id, targetUserId: row.userId };
    });

    if (!result.ok) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    await auditCompanyAction(req.user.id, req.user.companyId, "ADMIN_REQUEST_REJECTED", "AdminRequest", result.requestId, {
      targetUserId: result.targetUserId,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to reject request" });
  }
}
