import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { allocateUniqueSignupJoinCode } from "../utils/joinCode.js";
import { auditLog } from "../services/audit.service.js";
import { runWithAuthContextAsync } from "../utils/requestContext.js";

export async function getJoinCode(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { name: true, joinCode: true },
    });
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }
    res.json({ companyName: company.name, joinCode: company.joinCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load join code" });
  }
}

export async function regenerateJoinCode(req: AuthRequest, res: Response): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const actor = req.user;
  const companyId = actor.companyId;
  try {
    const joinCode = await prisma.$transaction(async (tx) => {
      const code = await allocateUniqueSignupJoinCode(tx.company);
      await tx.company.update({
        where: { id: companyId },
        data: { joinCode: code },
      });
      return code;
    });

    await runWithAuthContextAsync({ userId: actor.id, companyId }, async () => {
      const project = await prisma.project.findFirst({
        where: { companyId },
        orderBy: { name: "asc" },
      });
      if (project) {
        await auditLog({
          userId: actor.id,
          companyId,
          projectId: project.id,
          action: "REGENERATE_JOIN_CODE",
          entity: "Company",
          entityId: companyId,
        });
      }
    });

    res.json({ joinCode });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to regenerate join code" });
  }
}
