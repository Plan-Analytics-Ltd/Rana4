import type {
  ProgrammeSnapshotRole,
  ProgrammeSnapshotSourceType,
  RelationshipType,
} from "@prisma/client";

export const P6_HOURS_PER_DAY = 8;

export type ImportedActivityRow = {
  activityCode: string;
  name?: string;
  originalDurationDays?: number;
  remainingDurationDays?: number;
  actualDurationDays?: number;
  percentComplete?: number;
  startDate?: Date;
  finishDate?: Date;
  earlyStart?: Date;
  earlyFinish?: Date;
  lateStart?: Date;
  lateFinish?: Date;
  totalFloatDays?: number;
  freeFloatDays?: number;
  isCritical?: boolean;
  status?: string;
  classificationTags?: Record<string, string>;
};

export type ImportedDeliverableRow = {
  name: string;
  plannedStart?: Date;
  plannedFinish?: Date;
  actualStart?: Date;
  actualFinish?: Date;
  totalFloatDays?: number;
  status?: string;
  classificationTags?: Record<string, string>;
};

export type ImportedRelationshipRow = {
  predecessorActivityCode: string;
  successorActivityCode: string;
  relationshipType: RelationshipType;
  lag: number;
  matchedRelationshipId?: string;
};

export type ParsedProgrammeImport = {
  sourceType: ProgrammeSnapshotSourceType;
  scheduleDate?: Date;
  label?: string;
  activities: ImportedActivityRow[];
  deliverables: ImportedDeliverableRow[];
  relationships: ImportedRelationshipRow[];
  metrics?: Record<string, unknown>;
};

export type ProgrammeImportMatchResult = {
  matchedActivities: number;
  unmatchedActivityCodes: string[];
  matchedDeliverables: number;
  unmatchedDeliverableNames: string[];
  matchedRelationships: number;
  unmatchedRelationships: number;
};

export type SnapshotSummary = {
  id: string;
  projectId: string;
  importedAt: string;
  sourceType: ProgrammeSnapshotSourceType;
  snapshotRole: ProgrammeSnapshotRole | null;
  scheduleDate: string | null;
  label: string | null;
  snapshotVersion: number;
  metrics: Record<string, unknown>;
  importSummary: Record<string, unknown>;
  activityCount: number;
  deliverableCount: number;
};

export type ActivityVariance = {
  activityCode: string;
  activityId: string | null;
  name: string | null;
  durationVarianceDays: number | null;
  startVarianceDays: number | null;
  finishVarianceDays: number | null;
  floatErosionDays: number | null;
  logicVariance: boolean;
  baselineDurationDays: number | null;
  comparisonDurationDays: number | null;
  baselineFloatDays: number | null;
  comparisonFloatDays: number | null;
  becameCritical: boolean;
};

export type DeliverableVariance = {
  deliverableId: string | null;
  name: string;
  finishVarianceDays: number | null;
  delayed: boolean;
  bottleneckActivityCodes: string[];
};

export type ProjectVarianceSummary = {
  criticalPathInstability: number;
  approvalBottleneckCount: number;
  disciplineDelayCount: number;
  highRiskAreas: string[];
  totalActivitiesCompared: number;
  activitiesWithDurationVariance: number;
  activitiesWithFloatErosion: number;
};

export type PlannedVsActualReport = {
  baselineSnapshotId: string;
  comparisonSnapshotId: string;
  generatedAt: string;
  activityVariances: ActivityVariance[];
  deliverableVariances: DeliverableVariance[];
  projectSummary: ProjectVarianceSummary;
};

export type IntelligenceClassificationTags = {
  projectType?: string;
  ribaStage?: string;
  disciplineCategories?: string[];
  approvalRouteCategories?: string[];
  healthcareDepartments?: string[];
  deliverableClassifications?: string[];
  [key: string]: unknown;
};
