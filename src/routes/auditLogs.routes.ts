import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as auditLogsController from "../controllers/auditLogs.controller.js";

const router = Router();

router.use(requireAuth);
router.get("/", auditLogsController.list);

export default router;

