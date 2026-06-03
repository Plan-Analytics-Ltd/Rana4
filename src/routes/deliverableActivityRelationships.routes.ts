import { Router } from "express";
import * as deliverableActivityRelationshipsController from "../controllers/deliverableActivityRelationships.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);

router.post("/", deliverableActivityRelationshipsController.create);
router.get("/fragnet/:fragnetId", deliverableActivityRelationshipsController.getByFragnetId);
router.delete("/:id", deliverableActivityRelationshipsController.remove);

export default router;
