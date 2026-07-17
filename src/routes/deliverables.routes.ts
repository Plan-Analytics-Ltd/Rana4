import { Router } from "express";
import * as deliverablesController from "../controllers/deliverables.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", deliverablesController.create);
router.post("/duration-statistics/query", deliverablesController.queryDurationStatistics);
router.get("/fragnet/:fragnetId", deliverablesController.getByFragnetId);
router.get("/", deliverablesController.getAll);
router.get("/:id", deliverablesController.getById);
router.put("/:id", deliverablesController.update);
router.delete("/:id", deliverablesController.remove);

export default router;
