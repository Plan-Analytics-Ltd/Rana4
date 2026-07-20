import type { LearnedInsightType } from "@prisma/client";
import type { Response } from "express";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { listDeliverableKnowledgeProfiles } from "../services/intelligence/profiles/deliverableKnowledgeProfile.service.js";
import {
  getReliabilityProfileByClassification,
  listReliabilityProfiles,
  refreshDeliverableReliabilityProfiles,
} from "../services/intelligence/prediction/forecastReliability.service.js";
import {
  getOutcomeProfileByClassification,
  listOutcomeProfiles,
  refreshDeliverableOutcomeProfiles,
} from "../services/intelligence/prediction/outcomePrediction.service.js";
import {
  getLearnedInsightById,
  listLearnedInsights,
  type LearnedInsightFilters,
} from "../services/intelligence/learning/learningEngine.service.js";
import {
  getIntelligenceTrustProfileByClassification,
  listIntelligenceTrustProfiles,
  refreshIntelligenceTrustProfiles,
} from "../services/intelligence/trust/intelligenceTrust.service.js";
import {
  getRecommendationProfilesByClassification,
  groupRecommendationTrends,
  listRecommendationProfiles,
  refreshRecommendationProfiles,
} from "../services/intelligence/recommendations/recommendationEngine.service.js";
import { runPostImportLearningRefresh } from "../services/intelligence/learning/learningRefresh.service.js";
import { buildOrganisationKnowledge } from "../services/intelligence/matching/organisationKnowledge.service.js";
import {
  buildOrganisationalMemoryPresentation,
  getWorkPackageBrief,
} from "../services/intelligence/presentation/organisationalMemoryPresentation.service.js";
import { buildProgrammeReviewPresentation } from "../services/intelligence/presentation/programmeReviewPresentation.service.js";

const INSIGHT_TYPES: LearnedInsightType[] = [
  "DURATION_OVERRUN",
  "DURATION_PREDICTABILITY",
  "FLOAT_CONSUMPTION",
  "DRIVER_STRENGTH",
  "RECURRING_LESSON",
  "FORECAST_RELIABILITY",
  "OUTCOME_PREDICTION",
];

function parseInsightType(value: unknown): LearnedInsightType | undefined {
  const s = String(value ?? "").trim().toUpperCase();
  return INSIGHT_TYPES.includes(s as LearnedInsightType) ? (s as LearnedInsightType) : undefined;
}

function parseFilters(req: AuthRequest): LearnedInsightFilters {
  const limitRaw = Number(req.query.limit);
  return {
    insightType: parseInsightType(req.query.insightType ?? req.query.type),
    classification: String(req.query.classification ?? "").trim() || undefined,
    projectType: String(req.query.projectType ?? "").trim() || undefined,
    stage: String(req.query.stage ?? "").trim() || undefined,
    complexity: String(req.query.complexity ?? "").trim() || undefined,
    clientType: String(req.query.clientType ?? "").trim() || undefined,
    procurementRoute: String(req.query.procurementRoute ?? "").trim() || undefined,
    limit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined,
  };
}

/** GET /intelligence/dashboard — aggregated organisational intelligence for What We've Learned */
export async function getIntelligenceDashboard(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const refresh = req.query.refresh === "true" || req.query.refresh === "1";
    if (refresh) await runPostImportLearningRefresh(req.user.companyId);
    const companyId = req.user.companyId;
    const filters = parseFilters(req);
    const [insights, deliverableProfiles, reliabilityProfiles, outcomeProfiles, recommendationProfiles, trustProfiles] =
      await Promise.all([
        listLearnedInsights(companyId, filters),
        listDeliverableKnowledgeProfiles(companyId),
        listReliabilityProfiles(companyId),
        listOutcomeProfiles(companyId),
        listRecommendationProfiles(companyId),
        listIntelligenceTrustProfiles(companyId),
      ]);
    const recommendationTrends = groupRecommendationTrends(recommendationProfiles);
    res.json({
      insights,
      deliverableProfiles,
      reliabilityProfiles,
      outcomeProfiles,
      recommendationProfiles,
      recommendationTrends,
      trustProfiles,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load intelligence dashboard" });
  }
}

/** GET /intelligence/reliability-profiles */
export async function getReliabilityProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const profiles = await listReliabilityProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load reliability profiles" });
  }
}

/** GET /intelligence/reliability-profiles/:classification */
export async function getReliabilityProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const classification = String(req.params.classification ?? "").trim();
    const profile = await getReliabilityProfileByClassification(req.user.companyId, classification);
    if (!profile) {
      res.status(404).json({ error: "Reliability profile not found" });
      return;
    }
    res.json({ profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load reliability profile" });
  }
}

/** POST /intelligence/reliability-profiles/regenerate */
export async function postRegenerateReliabilityProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate reliability profiles" });
      return;
    }
    const updated = await refreshDeliverableReliabilityProfiles(req.user.companyId);
    const profiles = await listReliabilityProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length, profilesUpdated: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
}

/** GET /intelligence/outcome-profiles */
export async function getOutcomeProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const profiles = await listOutcomeProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load outcome profiles" });
  }
}

/** GET /intelligence/outcome-profiles/:classification */
export async function getOutcomeProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const classification = String(req.params.classification ?? "").trim();
    const profile = await getOutcomeProfileByClassification(req.user.companyId, classification);
    if (!profile) {
      res.status(404).json({ error: "Outcome profile not found" });
      return;
    }
    res.json({ profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load outcome profile" });
  }
}

/** POST /intelligence/outcome-profiles/regenerate */
export async function postRegenerateOutcomeProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate outcome profiles" });
      return;
    }
    const updated = await refreshDeliverableOutcomeProfiles(req.user.companyId);
    const profiles = await listOutcomeProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length, profilesUpdated: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
}

/** GET /intelligence/trust-profiles */
export async function getTrustProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const profiles = await listIntelligenceTrustProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load trust profiles" });
  }
}

/** GET /intelligence/trust-profiles/:classification */
export async function getTrustProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const classification = String(req.params.classification ?? "").trim();
    const profile = await getIntelligenceTrustProfileByClassification(req.user.companyId, classification);
    if (!profile) {
      res.status(404).json({ error: "Trust profile not found" });
      return;
    }
    res.json({ profile });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load trust profile" });
  }
}

/** POST /intelligence/trust-profiles/regenerate */
export async function postRegenerateTrustProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate trust profiles" });
      return;
    }
    const updated = await refreshIntelligenceTrustProfiles(req.user.companyId);
    const profiles = await listIntelligenceTrustProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length, profilesUpdated: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
}

/** GET /intelligence/recommendation-profiles */
export async function getRecommendationProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const profiles = await listRecommendationProfiles(req.user.companyId);
    const trends = groupRecommendationTrends(profiles);
    res.json({ profiles, trends, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load recommendation profiles" });
  }
}

/** GET /intelligence/recommendation-profiles/:classification */
export async function getRecommendationProfile(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const classification = String(req.params.classification ?? "").trim();
    const profiles = await getRecommendationProfilesByClassification(req.user.companyId, classification);
    if (profiles.length === 0) {
      res.status(404).json({ error: "Recommendation profiles not found" });
      return;
    }
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load recommendation profiles" });
  }
}

/** POST /intelligence/recommendation-profiles/regenerate */
export async function postRegenerateRecommendationProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate recommendation profiles" });
      return;
    }
    const updated = await refreshRecommendationProfiles(req.user.companyId);
    const profiles = await listRecommendationProfiles(req.user.companyId);
    const trends = groupRecommendationTrends(profiles);
    res.json({ profiles, trends, count: profiles.length, profilesUpdated: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
}

/** GET /intelligence/deliverable-profiles */
export async function getDeliverableKnowledgeProfiles(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const profiles = await listDeliverableKnowledgeProfiles(req.user.companyId);
    res.json({ profiles, count: profiles.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load profiles" });
  }
}

/** GET /intelligence/insights */
export async function getLearnedInsights(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const refresh = req.query.refresh === "true" || req.query.refresh === "1";
    if (refresh) await runPostImportLearningRefresh(req.user.companyId);
    const insights = refresh
      ? await listLearnedInsights(req.user.companyId, parseFilters(req))
      : await listLearnedInsights(req.user.companyId, parseFilters(req));
    res.json({ insights, count: insights.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load insights" });
  }
}

/** GET /intelligence/insights/by-type/:type */
export async function getLearnedInsightsByType(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const insightType = parseInsightType(req.params.type);
    if (!insightType) {
      res.status(400).json({ error: "Invalid insight type" });
      return;
    }
    const insights = await listLearnedInsights(req.user.companyId, {
      ...parseFilters(req),
      insightType,
    });
    res.json({ insights, count: insights.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load insights" });
  }
}

/** GET /intelligence/insights/:id */
export async function getLearnedInsight(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const id = String(req.params.id ?? "").trim();
    const insight = await getLearnedInsightById(req.user.companyId, id);
    if (!insight) {
      res.status(404).json({ error: "Insight not found" });
      return;
    }
    res.json({ insight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to load insight" });
  }
}

/** POST /intelligence/insights/regenerate */
export async function postRegenerateInsights(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    if (req.user.role !== "ADMIN") {
      res.status(403).json({ error: "Admin role required to regenerate organisational insights" });
      return;
    }
    const result = await runPostImportLearningRefresh(req.user.companyId);
    const insights = await listLearnedInsights(req.user.companyId);
    res.json({ insights, count: insights.length, ...result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Regeneration failed" });
  }
}

/** GET /intelligence/organisational-memory — work-package-centric organisational memory for planners */
export async function getOrganisationalMemory(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const report = await buildOrganisationalMemoryPresentation(req.user.companyId);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load organisational memory" });
  }
}

/** GET /intelligence/work-package-brief/:key */
export async function getWorkPackageBriefHandler(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const key = decodeURIComponent(String(req.params.key ?? "").trim()).toLowerCase();
    if (!key) {
      res.status(400).json({ error: "Work package key is required" });
      return;
    }
    const brief = await getWorkPackageBrief(req.user.companyId, key);
    if (!brief) {
      res.status(404).json({ error: "Work package not found in organisational memory" });
      return;
    }
    res.json({ brief });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load work package brief" });
  }
}

/** GET /intelligence/organisation-knowledge */
export async function getOrganisationKnowledge(req: AuthRequest, res: Response): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    const report = await buildOrganisationKnowledge(req.user.companyId);
    res.json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to load organisation knowledge" });
  }
}
