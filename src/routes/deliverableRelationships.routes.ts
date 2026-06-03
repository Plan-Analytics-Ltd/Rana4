import { Router } from "express";
import * as deliverableRelationshipsController from "../controllers/deliverableRelationships.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", deliverableRelationshipsController.create);
router.get("/fragnet/:fragnetId", deliverableRelationshipsController.getByFragnetId);
router.delete("/:id", deliverableRelationshipsController.remove);

export default router;
