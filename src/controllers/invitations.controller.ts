import type { Response } from "express";
import { randomUUID } from "node:crypto";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";
import { requirePermission } from "../permissions/projectPermissions.js";

const INVITE_TTL_DAYS = 7;

export async function invite(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { email, projectId } = req.body as { email?: string; projectId?: string };
    const emailStr = email != null ? String(email).trim().toLowerCase() : "";
    const projectIdStr = projectId != null ? String(projectId).trim() : "";
    if (!projectIdStr) {
      res.status(400).json({ error: "projectId is required" });
      return;
    }
    if (!emailStr) {
      res.status(400).json({ error: "Email is required" });
      return;
    }
    const membership = await requireProjectAccess(projectIdStr, req.user);
    requirePermission(membership.role, "invitation", "create");

    // Prevent inviting an email that already exists (globally unique).
    const existing = await prisma.user.findUnique({ where: { email: emailStr }, select: { id: true } });
    if (existing) {
      res.status(409).json({ error: "An account with this email already exists" });
      return;
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
    const invitation = await prisma.invitation.create({
      data: {
        email: emailStr,
        companyId: req.user.companyId,
        role: "VIEWER",
        token,
        expiresAt,
      },
      select: { id: true, email: true, role: true, token: true, expiresAt: true, createdAt: true },
    });

    await auditLog({
      userId: req.user.id,
      companyId: req.user.companyId,
      projectId: projectIdStr,
      action: "CREATE_INVITATION",
      entity: "Invitation",
      entityId: invitation.id,
    });

    // No email sending wired here; return token so the caller can deliver it out of band.
    res.status(201).json({
      invitation: {
        ...invitation,
        expiresAt: invitation.expiresAt.toISOString(),
        createdAt: invitation.createdAt.toISOString(),
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create invitation" });
  }
}

