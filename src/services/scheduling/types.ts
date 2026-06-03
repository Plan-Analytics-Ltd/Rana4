import type { RelationshipType } from "@prisma/client";

export type ScheduleDurationScenario = "best" | "likely";

export type ScheduleActivityInput = {
  id: string;
  activityCode: string;
  fragnetId: string;
  bestDuration: number;
  likelyDuration: number;
  constraintType?: string | null;
  constraintDate?: Date | null;
};

export type ScheduleRelationshipInput = {
  id: string;
  predecessorActivityId: string;
  successorActivityId: string;
  relationshipType: RelationshipType;
  lag: number;
};

export type ScheduleDiagnostic = {
  code: string;
  severity: "critical" | "warning" | "advisory" | "info";
  message: string;
  entityType?: "activity" | "relationship" | "project" | "network";
  entityId?: string;
  entityLabel?: string;
};

export type ComputedScheduleActivity = {
  id: string;
  activityCode: string;
  durationDays: number;
  earlyStart: Date;
  earlyFinish: Date;
  lateStart: Date;
  lateFinish: Date;
  totalFloat: number;
  freeFloat: number;
  isCritical: boolean;
  drivingRelationshipId: string | null;
  plannedStartDate: Date;
  plannedFinishDate: Date;
};

export type ScheduleNetworkInfo = {
  activityIds: string[];
  relationshipIds: string[];
  topologicalOrder: string[];
  cycleActivityIds: string[][];
  disconnectedComponents: string[][];
};

export type ScheduleResult = {
  ok: boolean;
  projectStart: Date;
  projectEnd: Date;
  scenario: ScheduleDurationScenario;
  activities: ComputedScheduleActivity[];
  criticalPathActivityIds: string[];
  network: ScheduleNetworkInfo;
  diagnostics: ScheduleDiagnostic[];
};
