import type { Response, NextFunction } from "express";
import type { AuthRequest } from "./auth.middleware.js";
import { getDevPanelAllowedEmails, isDevPanelEmail } from "../utils/devPanelAccess.js";

export function requireDevEmail(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const allowed = getDevPanelAllowedEmails();
  if (allowed.length === 0) {
    res.status(403).json({ error: "Dev access denied" });
    return;
  }
  if (!isDevPanelEmail(req.user.email)) {
    res.status(403).json({ error: "Dev access denied" });
    return;
  }
  next();
}
