import { Router } from "express";
import * as relationshipsController from "../controllers/relationships.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.post("/", relationshipsController.create);
router.get("/fragnet/:fragnetId", relationshipsController.getByFragnetId);
router.put("/:id", relationshipsController.update);
router.delete("/:id", relationshipsController.remove);

export default router;
