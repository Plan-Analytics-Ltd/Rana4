import type { Response } from "express";
import { prisma } from "../utils/prisma.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { requireProjectAccess } from "../services/projectAccess.service.js";

export async function getByFragnetId(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const { fragnetId } = req.params;
    const fragnet = await prisma.fragnet.findFirst({
      where: { id: fragnetId, companyId: req.user.companyId },
    });
    if (!fragnet) {
      res.status(404).json({ error: "Fragnet not found" });
      return;
    }
    await requireProjectAccess(fragnet.projectId, req.user);
    const rows = await prisma.activityToDeliverableRelationship.findMany({
      where: { fragnetId, companyId: req.user.companyId },
      orderBy: { id: "asc" },
    });
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch activity → deliverable relationships" });
  }
}
