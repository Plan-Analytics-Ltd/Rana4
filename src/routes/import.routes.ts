import { Router } from "express";
import * as importController from "../controllers/import.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.get("/template", importController.downloadImportTemplate);

export default router;
