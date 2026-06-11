import { refreshDeliverableKnowledgeProfiles } from "./deliverableKnowledgeProfile.service.js";
import { refreshDeliverableReliabilityProfiles } from "./forecastReliability.service.js";
import { generateAllInsights } from "./learningEngine.service.js";
import { refreshDeliverableOutcomeProfiles } from "./outcomePrediction.service.js";
import { refreshRecommendationProfiles } from "./recommendationEngine.service.js";

export type LearningRefreshResult = {
  reliabilityProfilesUpdated: number;
  profilesUpdated: number;
  outcomeProfilesUpdated: number;
  recommendationProfilesUpdated: number;
  insightsGenerated: number;
};

/**
 * Post-import learning loop:
 * Snapshot → reliability → deliverable profiles → outcome profiles → recommendations → insights.
 */
export async function runPostImportLearningRefresh(companyId: string): Promise<LearningRefreshResult> {
  const reliabilityProfilesUpdated = await refreshDeliverableReliabilityProfiles(companyId);
  const profilesUpdated = await refreshDeliverableKnowledgeProfiles(companyId);
  const outcomeProfilesUpdated = await refreshDeliverableOutcomeProfiles(companyId);
  const recommendationProfilesUpdated = await refreshRecommendationProfiles(companyId);
  const insights = await generateAllInsights(companyId);
  return {
    reliabilityProfilesUpdated,
    profilesUpdated,
    outcomeProfilesUpdated,
    recommendationProfilesUpdated,
    insightsGenerated: insights.length,
  };
}
