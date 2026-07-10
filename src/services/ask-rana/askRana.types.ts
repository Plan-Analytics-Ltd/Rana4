import type { PlannerQuery } from "./askRanaPlannerQuery.types.js";

export type AskRanaConversationTurn = {
  role: "planner" | "rana";
  content: string;
};

export type AskRanaEvidenceDomain =
  | "previousProjects"
  | "projectEvolution"
  | "programmeLogic"
  | "recommendations"
  | "observations"
  | "keyFactors"
  | "trust"
  | "lessonsLearned"
  | "similarProjects";

export type AskRanaRequest = {
  projectId: string;
  companyId: string;
  deliverableId?: string | null;
  question: string;
  conversation?: AskRanaConversationTurn[];
  selectedProjectIds?: string[];
  pageContext?: string | null;
};

export type AskRanaDeliverableContext = {
  name: string;
  classification: string | null;
  currentDurationDays: number | null;
};

export type AskRanaPreviousProjectsContext = {
  available: boolean;
  currentDurationDays: number | null;
  comparisonAssessment: string | null;
  typicalRangeLabel: string | null;
  typicalDurationDays: number | null;
  sampleSize: number;
  completedProjectCount: number;
  comparableWork: Array<{
    deliverableName: string;
    projectName: string;
    durationDays: number | null;
    programmeState: string | null;
  }>;
  observations: string[];
};

export type AskRanaProjectEvolutionContext = {
  available: boolean;
  revisionCount: number;
  summary: string | null;
  baselineDays: number | null;
  latestDays: number | null;
  netChangeDays: number | null;
  trend: string | null;
  changePattern: string | null;
  volatility: string | null;
  howChangedSummary: string | null;
  timelineHighlights: string[];
  plannerObservations: string[];
  revisionHighlights: Array<{
    label: string;
    role: string | null;
    durationDays: number;
    changeDays: number | null;
    reason: string;
  }>;
  stablePeriods: Array<{
    startLabel: string;
    endLabel: string;
    durationDays: number;
    revisionCount: number;
  }>;
  revisions: Array<{
    label: string;
    role: string | null;
    importedAt: string;
    durationDays: number | null;
    durationChangeDays: number | null;
  }>;
  showFullTimeline: boolean;
};

export type AskRanaProgrammeLogicContext = {
  available: boolean;
  summary: string | null;
  revisions: Array<{
    label: string;
    relationshipCount: number | null;
    relationshipCountChange: number | null;
    events: Array<{
      type: string;
      activityCode: string;
      description: string;
      predecessorCode?: string;
      lagDays?: number;
    }>;
    plannerObservations: string[];
  }>;
};

export type AskRanaRecommendationsContext = {
  available: boolean;
  items: Array<{
    title: string;
    summary: string;
    recommendation: string;
    severity: string;
  }>;
};

export type AskRanaLessonsContext = {
  available: boolean;
  items: Array<{
    title: string;
    summary: string;
    category: string;
  }>;
};

export type AskRanaSimilarProjectsContext = {
  available: boolean;
  items: Array<{
    projectName: string;
    similarityPhrase: string;
    explanations: string[];
  }>;
};

export type AskRanaTrustContext = {
  available: boolean;
  band: string | null;
  summary: string | null;
};

export type AskRanaEvidencePackage = {
  deliverable: AskRanaDeliverableContext;
  plannerQuery?: PlannerQuery;
  previousProjects: AskRanaPreviousProjectsContext | null;
  projectEvolution: AskRanaProjectEvolutionContext | null;
  programmeLogic: AskRanaProgrammeLogicContext | null;
  recommendations: AskRanaRecommendationsContext | null;
  observations: string[] | null;
  keyFactors: string[] | null;
  trust: AskRanaTrustContext | null;
  lessonsLearned: AskRanaLessonsContext | null;
  similarProjects: AskRanaSimilarProjectsContext | null;
  sources: AskRanaEvidenceDomain[];
  evidenceGaps: string[];
};

export type AskRanaResult = {
  status: "success" | "disabled" | "error" | "not_ready" | "provider_not_configured" | "mock";
  answer: string | null;
  message?: string;
  sources: AskRanaEvidenceDomain[];
  plannerQuery?: PlannerQuery;
  providerCalled: boolean;
  providerId?: string;
};
