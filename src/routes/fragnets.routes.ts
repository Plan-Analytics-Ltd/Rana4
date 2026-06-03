import { Router } from "express";
import * as fragnetsController from "../controllers/fragnets.controller.js";
import * as fragnetActivityTemplatesController from "../controllers/fragnetActivityTemplates.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", fragnetsController.create);
router.get("/standard/:standardId", fragnetsController.getByStandardId);

router.get("/:fragnetId/activity-templates", fragnetActivityTemplatesController.list);
router.post("/:fragnetId/activity-templates", fragnetActivityTemplatesController.create);
router.put("/:fragnetId/activity-templates/:templateId", fragnetActivityTemplatesController.update);
router.delete("/:fragnetId/activity-templates/:templateId", fragnetActivityTemplatesController.remove);
router.post("/:fragnetId/activity-templates/relationships", fragnetActivityTemplatesController.createRelationship);
router.delete("/:fragnetId/activity-templates/relationships/:relId", fragnetActivityTemplatesController.deleteRelationship);
router.post("/:fragnetId/activity-templates/sync", fragnetActivityTemplatesController.sync);
router.post("/:fragnetId/activity-templates/materialize", fragnetActivityTemplatesController.materialize);
router.post("/:fragnetId/activity-templates/realign-codes", fragnetActivityTemplatesController.realignCodes);

router.get("/:id", fragnetsController.getById);
router.put("/:id", fragnetsController.update);
router.delete("/:id", fragnetsController.remove);

export default router;
