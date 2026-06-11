import { Router } from "express";
import * as learningInsightsController from "../controllers/learningInsights.controller.js";
import * as programmeIntelligenceController from "../controllers/programmeIntelligence.controller.js";
import { requireAuth } from "../middleware/auth.middleware.js";

const router = Router();

router.use(requireAuth);
router.get("/portfolio-benchmarks", programmeIntelligenceController.getPortfolioBenchmarks);
router.get("/lessons-learned", programmeIntelligenceController.getLessonsLearned);
router.post("/lessons-learned/generate", programmeIntelligenceController.postGenerateLessons);

router.get("/deliverable-profiles", learningInsightsController.getDeliverableKnowledgeProfiles);
router.post("/recommendation-profiles/regenerate", learningInsightsController.postRegenerateRecommendationProfiles);
router.get("/recommendation-profiles/:classification", learningInsightsController.getRecommendationProfile);
router.get("/recommendation-profiles", learningInsightsController.getRecommendationProfiles);
router.post("/outcome-profiles/regenerate", learningInsightsController.postRegenerateOutcomeProfiles);
router.get("/outcome-profiles/:classification", learningInsightsController.getOutcomeProfile);
router.get("/outcome-profiles", learningInsightsController.getOutcomeProfiles);
router.post("/reliability-profiles/regenerate", learningInsightsController.postRegenerateReliabilityProfiles);
router.get("/reliability-profiles/:classification", learningInsightsController.getReliabilityProfile);
router.get("/reliability-profiles", learningInsightsController.getReliabilityProfiles);
router.get("/insights/by-type/:type", learningInsightsController.getLearnedInsightsByType);
router.post("/insights/regenerate", learningInsightsController.postRegenerateInsights);
router.get("/insights/:id", learningInsightsController.getLearnedInsight);
router.get("/insights", learningInsightsController.getLearnedInsights);

export default router;
