import { Router } from "express";
import * as activityCodeTypesController from "../controllers/activityCodeTypes.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();
router.use(requireAuth);
router.get("/", activityCodeTypesController.list);
router.post("/", activityCodeTypesController.create);
router.put("/:id", activityCodeTypesController.update);
router.delete("/:id", activityCodeTypesController.remove);

export default router;
