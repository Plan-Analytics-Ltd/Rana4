import { Router } from "express";
import { requireAuth } from "../middleware/auth.middleware.js";
import * as auditLogsController from "../controllers/auditLogs.controller.js";

const router = Router();

router.use(requireAuth);
router.get("/secure", auditLogsController.secureSearch);
router.get("/secure/access-history", auditLogsController.accessHistory);
router.get("/secure/decrypt-activity", auditLogsController.decryptActivity);
router.get("/secure/denied-access", auditLogsController.deniedAccess);
router.get("/", auditLogsController.list);

export default router;

