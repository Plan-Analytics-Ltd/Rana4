import { Router } from "express";
import * as programmeIntelligenceController from "../controllers/programmeIntelligence.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.get("/portfolio-benchmarks", programmeIntelligenceController.getPortfolioBenchmarks);
router.get("/lessons-learned", programmeIntelligenceController.getLessonsLearned);
router.post("/lessons-learned/generate", programmeIntelligenceController.postGenerateLessons);

export default router;
