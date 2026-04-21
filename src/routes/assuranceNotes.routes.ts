import { Router } from "express";
import * as assuranceNotesController from "../controllers/assuranceNotes.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", assuranceNotesController.create);
router.get("/standard/:standardId", assuranceNotesController.getByStandardId);
router.put("/:id", assuranceNotesController.update);
router.delete("/:id", assuranceNotesController.remove);

export default router;
