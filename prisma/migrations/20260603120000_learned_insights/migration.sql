-- Phase 4A: Organisational Learning Engine — LearnedInsight entity

CREATE TYPE "LearnedInsightType" AS ENUM (
  'DURATION_OVERRUN',
  'DURATION_PREDICTABILITY',
  'FLOAT_CONSUMPTION',
  'DRIVER_STRENGTH',
  'RECURRING_LESSON'
);

CREATE TYPE "LearnedInsightConfidenceLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

CREATE TABLE "learned_insights" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "insight_type" "LearnedInsightType" NOT NULL,
  "title" VARCHAR(512) NOT NULL,
  "summary" TEXT NOT NULL,
  "observation" TEXT NOT NULL,
  "category" VARCHAR(64),
  "classification" VARCHAR(64),
  "project_type" VARCHAR(64),
  "stage" VARCHAR(64),
  "complexity" VARCHAR(64),
  "client_type" VARCHAR(64),
  "procurement_route" VARCHAR(64),
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "confidence_level" "LearnedInsightConfidenceLevel" NOT NULL,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "evidence_json" JSONB NOT NULL DEFAULT '{}',
  "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "learned_insights_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learned_insights_company_id_insight_type_idx" ON "learned_insights"("company_id", "insight_type");
CREATE INDEX "learned_insights_company_id_classification_idx" ON "learned_insights"("company_id", "classification");
CREATE INDEX "learned_insights_company_id_project_type_idx" ON "learned_insights"("company_id", "project_type");
CREATE INDEX "learned_insights_company_id_last_calculated_at_idx" ON "learned_insights"("company_id", "last_calculated_at");

ALTER TABLE "learned_insights"
  ADD CONSTRAINT "learned_insights_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
