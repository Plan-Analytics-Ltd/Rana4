import { Router } from "express";
import * as standardsController from "../controllers/standards.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", standardsController.create);
router.get("/", standardsController.getAll);
router.get("/:id", standardsController.getById);
router.put("/:id", standardsController.update);
router.delete("/:id", standardsController.remove);

export default router;
