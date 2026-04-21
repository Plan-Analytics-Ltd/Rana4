import type { Response } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { auditLog } from "../services/audit.service.js";
import { runWithAuthContextAsync } from "../utils/requestContext.js";
import { allocateUniqueSignupJoinCode, normalizeJoinCode } from "../utils/joinCode.js";
import { signToken } from "../utils/auth.js";
import { isDevPanelEmail } from "../utils/devPanelAccess.js";

async function safeAuditLog(input: Parameters<typeof auditLog>[0]): Promise<void> {
  try {
    await auditLog(input);
  } catch (e) {
    console.error("REGISTER AUDIT (non-fatal):", e);
  }
}

function toUserResponse(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
  role?: "ADMIN" | "EDITOR" | "VIEWER";
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
    ...(user.role ? { role: user.role } : {}),
    devPanelAccess: isDevPanelEmail(user.email),
  };
}

export async function register(req: AuthRequest, res: Response): Promise<void> {
  try {
    const rawBody = req.body as Record<string, unknown>;
    for (const k of ["role", "companyId", "company_id"] as const) {
      const v = rawBody[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        res.status(400).json({
          error: "Do not send role or company id. The server assigns company and role from your join code or new company name.",
        });
        return;
      }
    }

    const body = req.body as {
      email?: string;
      password?: string;
      name?: string | null;
      inviteToken?: string;
      joinCode?: string;
      companyName?: string;
    };
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      res.status(400).json({ error: "Missing email or password" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters" });
      return;
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      res.status(400).json({ error: "User already exists" });
      return;
    }

    const name = body.name != null ? String(body.name).trim() || null : null;
    const invite = typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
    const joinCodeNorm =
      typeof body.joinCode === "string" && body.joinCode.trim() !== "" ? normalizeJoinCode(body.joinCode) : "";
    const companyNameTrimmed =
      typeof body.companyName === "string" && body.companyName.trim() !== "" ? body.companyName.trim() : "";

    const passwordHash = await bcrypt.hash(password, 10);

    let createdUser: {
      id: string;
      email: string;
      name: string | null;
      createdAt: Date;
      role: "ADMIN" | "EDITOR" | "VIEWER";
    };

    if (joinCodeNorm) {
      const company = await prisma.company.findUnique({
        where: { joinCode: joinCodeNorm },
      });
      if (!company) {
        res.status(400).json({ error: "Invalid join code" });
        return;
      }
      const companyId = company.id;

      const user = await runWithAuthContextAsync({ userId: "bootstrap", companyId }, async () => {
        const u = await prisma.user.create({
          data: {
            email,
            name,
            passwordHash,
            companyId,
            role: "VIEWER",
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });

        let project = await prisma.project.findFirst({
          where: { companyId },
          orderBy: { name: "asc" },
        });
        if (!project) {
          project = await prisma.project.create({
            data: { name: "Default Project", companyId },
          });
        }
        await prisma.projectMember.upsert({
          where: { userId_projectId: { userId: u.id, projectId: project.id } },
          create: { userId: u.id, projectId: project.id, role: "VIEWER" },
          update: {},
        });

        await safeAuditLog({
          userId: u.id,
          companyId,
          projectId: project.id,
          action: "JOIN_COMPANY",
          entity: "User",
          entityId: u.id,
          details: { via: "join_code" },
        });

        return u;
      });

      createdUser = user as {
        id: string;
        email: string;
        name: string | null;
        createdAt: Date;
        role: "ADMIN" | "EDITOR" | "VIEWER";
      };
    } else if (companyNameTrimmed) {
      const companyDisplayName = companyNameTrimmed.slice(0, 255);

      // IMPORTANT: Prisma enforces company-scoped access for many models (e.g. projects).
      // We can't create the default project until we have a companyId AND have set request context.
      const { user: u, companyId } = await prisma.$transaction(async (tx) => {
        const joinCodeVal = await allocateUniqueSignupJoinCode(tx.company);
        const company = await tx.company.create({
          data: { name: companyDisplayName, joinCode: joinCodeVal },
        });
        const cid = company.id;
        const newUser = await tx.user.create({
          data: {
            email,
            name,
            passwordHash,
            companyId: cid,
            role: "ADMIN",
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });
        return { user: newUser, companyId: cid };
      });

      const { projectId } = await runWithAuthContextAsync({ userId: u.id, companyId }, async () => {
        const project = await prisma.project.create({
          data: { name: "Default Project", companyId },
        });
        await prisma.projectMember.create({
          data: { projectId: project.id, userId: u.id, role: "ADMIN" },
        });
        return { projectId: project.id };
      });

      await runWithAuthContextAsync({ userId: u.id, companyId }, async () => {
        await safeAuditLog({
          userId: u.id,
          companyId,
          projectId,
          action: "REGISTER",
          entity: "User",
          entityId: u.id,
        });
      });

      createdUser = u as {
        id: string;
        email: string;
        name: string | null;
        createdAt: Date;
        role: "ADMIN" | "EDITOR" | "VIEWER";
      };
    } else if (invite) {
      const invitation = (await (prisma as any).invitation.findUnique({ where: { token: invite } })) as any;
      if (!invitation) {
        res.status(400).json({ error: "Invalid invitation token" });
        return;
      }
      if (invitation.expiresAt.getTime() < Date.now()) {
        res.status(400).json({ error: "Invitation token expired" });
        return;
      }
      if (String(invitation.email).toLowerCase() !== email) {
        res.status(400).json({ error: "Invitation token does not match this email" });
        return;
      }
      const companyId = invitation.companyId != null ? String(invitation.companyId).trim() : "";
      if (!companyId) {
        res.status(400).json({ error: "Invitation is not associated with a company" });
        return;
      }

      const user = await runWithAuthContextAsync({ userId: "bootstrap", companyId }, async () => {
        const u = await (prisma as any).user.create({
          data: {
            email,
            name,
            passwordHash,
            companyId,
            role: invitation.role,
            emailVerified: true,
            emailVerifiedAt: new Date(),
          },
        });

        await (prisma as any).invitation.delete({ where: { token: invite } });

        let project = await (prisma as any).project.findFirst({
          where: { companyId },
          orderBy: { name: "asc" },
        });
        if (!project) {
          project = await (prisma as any).project.create({
            data: { name: "Default Project", companyId },
          });
        }
        await (prisma as any).projectMember.upsert({
          where: { userId_projectId: { userId: u.id, projectId: project.id } },
          create: { userId: u.id, projectId: project.id, role: "VIEWER" },
          update: {},
        });

        await safeAuditLog({
          userId: u.id,
          companyId,
          projectId: project.id,
          action: "ACCEPT_INVITATION",
          entity: "User",
          entityId: u.id,
        });

        return u;
      });

      createdUser = user;
    } else {
      res.status(400).json({
        error: "Provide join code or company name",
      });
      return;
    }

    const token = signToken({ userId: createdUser.id, email: createdUser.email });
    res.status(201).json({ user: toUserResponse(createdUser), token });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Register failed",
    });
  }
}

export async function login(req: AuthRequest, res: Response): Promise<void> {
  try {
    const { email, password } = req.body as { email?: string; password?: string };
    const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!emailStr || typeof password !== "string" || !password) {
      res.status(400).json({ error: "Email and password are required" });
      return;
    }

    const user = (await prisma.user.findUnique({
      where: { email: emailStr },
    })) as any;
    if (!user?.passwordHash) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash as string);
    if (!ok) {
      res.status(401).json({ error: "Invalid email or password" });
      return;
    }

    const token = signToken({ userId: user.id, email: user.email });
    res.json({ user: toUserResponse(user), token });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to sign in" });
  }
}

export async function me(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = (await (prisma as any).user.findUnique({
    where: { id: req.user.id },
  })) as any;
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(toUserResponse(user));
}

export async function updateMe(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const rawBody = req.body as Record<string, unknown>;
    for (const k of ["role", "companyId", "company_id"] as const) {
      const v = rawBody[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") {
        res.status(400).json({ error: "Cannot set role or company id from this endpoint." });
        return;
      }
    }

    const { name } = req.body as { name?: string };
    if (name === undefined) {
      const user = (await (prisma as any).user.findUniqueOrThrow({
        where: { id: req.user.id },
      })) as any;
      res.json(toUserResponse(user));
      return;
    }
    const user = (await (prisma as any).user.update({
      where: { id: req.user.id },
      data: { name: String(name).trim() || null },
    })) as any;
    res.json(toUserResponse(user));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update profile" });
  }
}

export async function changePassword(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || typeof newPassword !== "string" || newPassword.length < 8) {
      res.status(400).json({ error: "currentPassword and newPassword (min 8 characters) are required" });
      return;
    }
    const u = (await prisma.user.findUnique({ where: { id: req.user.id } })) as any;
    if (!u?.passwordHash || !(await bcrypt.compare(String(currentPassword), u.passwordHash))) {
      res.status(401).json({ error: "Current password is incorrect" });
      return;
    }
    await prisma.user.update({
      where: { id: req.user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, 10) },
    });
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to change password" });
  }
}
