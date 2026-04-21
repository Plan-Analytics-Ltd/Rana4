import { Router } from "express";
import * as fragnetsController from "../controllers/fragnets.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", fragnetsController.create);
router.get("/standard/:standardId", fragnetsController.getByStandardId);
router.get("/:id", fragnetsController.getById);
router.put("/:id", fragnetsController.update);
router.delete("/:id", fragnetsController.remove);

export default router;
