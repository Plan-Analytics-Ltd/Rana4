import type { Request, Response } from "express";
import { isPrismaConnectionError, prisma, withPrismaRetry } from "../utils/prisma.js";

export async function getHealth(_req: Request, res: Response): Promise<void> {
  try {
    await withPrismaRetry(() => prisma.$queryRaw`SELECT 1`);
    res.json({ status: "ok", database: "ok" });
  } catch (err) {
    if (isPrismaConnectionError(err)) {
      res.status(503).json({ status: "degraded", database: "unavailable" });
      return;
    }
    throw err;
  }
}
