import { Router } from "express";
import multer from "multer";
import * as rateCardController from "../controllers/rateCard.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";
import { requireSensitiveAccessMiddleware } from "../middleware/security/sensitiveAccess.middleware.js";
import { requireSensitiveApproval } from "../middleware/security/sensitiveApproval.middleware.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);
router.get(
  "/secure/current",
  requireSensitiveAccessMiddleware({ resourceType: "rateCard", operation: "read" }),
  requireSensitiveApproval((req) => ({
    action: "read",
    resourceCategory: "rateCard",
    resourceId: `rateCard:${req.user!.companyId}`,
    resourceType: typeof req.query.resourceType === "string" && req.query.resourceType.trim() ? req.query.resourceType.trim() : "rateCard",
  })),
  rateCardController.getSecureRateCardExample
);
router.get("/", rateCardController.listRateCard);
router.delete("/", rateCardController.clearRateCard);
router.post("/upload", upload.single("file"), rateCardController.uploadRateCard);

export default router;
