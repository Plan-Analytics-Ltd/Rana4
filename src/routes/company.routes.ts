import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import * as companyController from "../controllers/company.controller.js";

const router = Router();

router.get("/join-code", requireAuth, requireRole("ADMIN"), companyController.getJoinCode);
router.post("/regenerate-code", requireAuth, requireRole("ADMIN"), companyController.regenerateJoinCode);

export default router;
