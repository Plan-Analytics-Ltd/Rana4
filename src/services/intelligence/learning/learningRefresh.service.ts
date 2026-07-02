import { refreshDeliverableKnowledgeProfiles } from "../profiles/deliverableKnowledgeProfile.service.js";
import { refreshDeliverableReliabilityProfiles } from "../prediction/forecastReliability.service.js";
import { generateAllInsights } from "./learningEngine.service.js";
import { refreshDeliverableOutcomeProfiles } from "../prediction/outcomePrediction.service.js";
import { refreshIntelligenceTrustProfiles } from "../trust/intelligenceTrust.service.js";
import { refreshRecommendationProfiles } from "../recommendations/recommendationEngine.service.js";
import { repairCompanyHistoricalLearningEvidence } from "./historicalLearningRepair.service.js";
import { buildOrganisationKnowledge } from "../matching/organisationKnowledge.service.js";

export type LearningRefreshResult = {
  repair: Awaited<ReturnType<typeof repairCompanyHistoricalLearningEvidence>>;
  organisationKnowledge: Awaited<ReturnType<typeof buildOrganisationKnowledge>>;
  reliabilityProfilesUpdated: number;
  profilesUpdated: number;
  outcomeProfilesUpdated: number;
  recommendationProfilesUpdated: number;
  trustProfilesUpdated: number;
  insightsGenerated: number;
};

/**
 * Post-import learning loop:
 * Snapshot → reliability → deliverable profiles → outcome → recommendations → trust → insights.
 */
export async function runPostImportLearningRefresh(companyId: string): Promise<LearningRefreshResult> {
  const repair = await repairCompanyHistoricalLearningEvidence(companyId);
  const organisationKnowledge = await buildOrganisationKnowledge(companyId);
  const reliabilityProfilesUpdated = await refreshDeliverableReliabilityProfiles(companyId);
  const profilesUpdated = await refreshDeliverableKnowledgeProfiles(companyId);
  const outcomeProfilesUpdated = await refreshDeliverableOutcomeProfiles(companyId);
  const recommendationProfilesUpdated = await refreshRecommendationProfiles(companyId);
  const trustProfilesUpdated = await refreshIntelligenceTrustProfiles(companyId);
  const insights = await generateAllInsights(companyId);
  return {
    repair,
    organisationKnowledge,
    reliabilityProfilesUpdated,
    profilesUpdated,
    outcomeProfilesUpdated,
    recommendationProfilesUpdated,
    trustProfilesUpdated,
    insightsGenerated: insights.length,
  };
}
