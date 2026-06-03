import { Router } from "express";
import * as activityToDeliverableRelationshipsController from "../controllers/activityToDeliverableRelationships.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);

router.get("/fragnet/:fragnetId", activityToDeliverableRelationshipsController.getByFragnetId);

export default router;
