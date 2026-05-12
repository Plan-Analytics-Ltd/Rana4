import { Router } from "express";
import * as exportController from "../controllers/export.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireSensitiveApproval } from "../middleware/security/sensitiveApproval.middleware.js";

const router = Router();

router.use(requireAuth);
const requireRateCardDecryptApproval = requireSensitiveApproval((req) => ({
  action: "read",
  resourceCategory: "rateCard",
  resourceId: `rateCard:${req.user!.companyId}`,
  resourceType: "rateCard",
}));

router.post("/fragnet/:fragnetId", requireRateCardDecryptApproval, exportController.exportFragnet);
router.post("/standard/:standardId", requireRateCardDecryptApproval, exportController.exportStandard);
router.get("/standard/:standardId/validate-activities", exportController.validateStandardActivities);

export default router;
