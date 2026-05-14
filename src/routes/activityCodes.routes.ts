import { Router } from "express";
import * as activityCodesController from "../controllers/activityCodes.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.get("/", activityCodesController.listByType);
router.post("/", activityCodesController.create);
router.put("/:id", activityCodesController.update);
router.delete("/:id", activityCodesController.remove);

export default router;
