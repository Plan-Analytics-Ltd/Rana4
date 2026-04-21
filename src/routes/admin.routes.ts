import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import * as adminController from "../controllers/admin.controller.js";

const router = Router();

router.get("/request/mine", requireAuth, adminController.getMyRequest);
router.get("/my-request", requireAuth, adminController.getMyRequest);
router.post("/request", requireAuth, adminController.createRequest);
router.get("/requests", requireAuth, requireRole("ADMIN"), adminController.listPendingRequests);
router.post("/requests/:id/approve", requireAuth, requireRole("ADMIN"), adminController.approveRequest);
router.post("/requests/:id/reject", requireAuth, requireRole("ADMIN"), adminController.rejectRequest);

export default router;
