import { Router } from "express";
import * as activitiesController from "../controllers/activities.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", activitiesController.create);
router.get("/fragnet/:fragnetId", activitiesController.getByFragnetId);
router.get("/:id", activitiesController.getById);
router.get("/:id/versions", activitiesController.getVersions);
router.put("/:id", activitiesController.update);
router.patch("/:id/status", activitiesController.updateStatus);
router.patch("/:id/submit", activitiesController.submit);
router.patch("/:id/approve", activitiesController.approve);
router.patch("/:id/reject", activitiesController.reject);
router.patch("/:id/detach-from-template", activitiesController.detachFromTemplate);
router.post("/:id/rollback", activitiesController.rollback);
router.delete("/:id", activitiesController.remove);

export default router;
