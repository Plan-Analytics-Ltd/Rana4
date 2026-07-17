import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireDevEmail } from "../middleware/dev.middleware.js";
import * as engineeringIdentityDebugController from "../controllers/engineeringIdentityDebug.controller.js";

/**
 * Developer-only debug exports.
 * Mounted at /api/debug — never exposed to planners.
 */
const router = Router();

router.use(requireAuth, requireDevEmail);

router.get("/identity-review", engineeringIdentityDebugController.exportIdentityReviewDebug);

export default router;
