-- CPM scheduling fields on activities and project schedule anchor.

CREATE TYPE "ScheduleConstraintType" AS ENUM (
  'AS_SOON_AS_POSSIBLE',
  'START_NO_EARLIER_THAN',
  'START_NO_LATER_THAN',
  'FINISH_NO_EARLIER_THAN',
  'FINISH_NO_LATER_THAN',
  'MUST_START_ON',
  'MUST_FINISH_ON'
);

ALTER TABLE "projects" ADD COLUMN "schedule_start_date" DATE;

ALTER TABLE "activities" ADD COLUMN "planned_start_date" DATE;
ALTER TABLE "activities" ADD COLUMN "planned_finish_date" DATE;
ALTER TABLE "activities" ADD COLUMN "early_start" DATE;
ALTER TABLE "activities" ADD COLUMN "early_finish" DATE;
ALTER TABLE "activities" ADD COLUMN "late_start" DATE;
ALTER TABLE "activities" ADD COLUMN "late_finish" DATE;
ALTER TABLE "activities" ADD COLUMN "total_float" INTEGER;
ALTER TABLE "activities" ADD COLUMN "free_float" INTEGER;
ALTER TABLE "activities" ADD COLUMN "is_critical" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "activities" ADD COLUMN "driving_relationship_id" TEXT;
ALTER TABLE "activities" ADD COLUMN "calendar_id" TEXT;
ALTER TABLE "activities" ADD COLUMN "constraint_type" "ScheduleConstraintType";
ALTER TABLE "activities" ADD COLUMN "constraint_date" DATE;

CREATE INDEX "activities_is_critical_idx" ON "activities" ("project_id", "is_critical");
