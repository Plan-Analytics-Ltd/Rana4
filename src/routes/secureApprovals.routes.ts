import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import * as secureApprovalsController from "../controllers/secureApprovals.controller.js";

const router = Router();

router.use(requireAuth, requireRole("ADMIN"));
router.get("/pending", secureApprovalsController.pending);
router.get("/history", secureApprovalsController.history);
router.post("/:id/approve", secureApprovalsController.approve);
router.post("/:id/deny", secureApprovalsController.deny);
router.post("/:id/revoke", secureApprovalsController.revoke);

export default router;
