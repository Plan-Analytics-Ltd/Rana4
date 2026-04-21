import { Router } from "express";
import * as exportController from "../controllers/export.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/fragnet/:fragnetId", exportController.exportFragnet);

export default router;
