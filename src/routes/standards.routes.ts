import { Router } from "express";
import multer from "multer";
import * as standardsController from "../controllers/standards.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

const router = Router();

router.use(requireAuth);
router.post("/", standardsController.create);
router.get("/", standardsController.getAll);
router.post("/:id/import-assignments", upload.single("file"), standardsController.importAssignmentsSheet);
router.get("/:id", standardsController.getById);
router.put("/:id", standardsController.update);
router.delete("/:id", standardsController.remove);

export default router;
