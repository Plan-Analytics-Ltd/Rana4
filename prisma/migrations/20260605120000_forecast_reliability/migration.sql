ALTER TYPE "LearnedInsightType" ADD VALUE 'FORECAST_RELIABILITY';

CREATE TYPE "ReliabilityBand" AS ENUM (
  'HIGHLY_RELIABLE',
  'GENERALLY_RELIABLE',
  'MIXED_RELIABILITY',
  'FREQUENTLY_OVERRUNS',
  'HIGHLY_UNPREDICTABLE'
);

CREATE TABLE "deliverable_reliability_profiles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "classification" "DeliverableClassification" NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "project_count" INTEGER NOT NULL DEFAULT 0,
  "planned_average_duration" DOUBLE PRECISION,
  "actual_average_duration" DOUBLE PRECISION,
  "average_variance_percent" DOUBLE PRECISION,
  "average_variance_days" DOUBLE PRECISION,
  "overrun_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "underrun_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "on_target_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "predictability_score" DOUBLE PRECISION,
  "reliability_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reliability_band" "ReliabilityBand" NOT NULL DEFAULT 'MIXED_RELIABILITY',
  "reliability_label" VARCHAR(64) NOT NULL DEFAULT 'Mixed Reliability',
  "confidence_level" VARCHAR(16) NOT NULL DEFAULT 'LOW',
  "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "deliverable_reliability_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deliverable_reliability_profiles_company_id_classification_key"
  ON "deliverable_reliability_profiles"("company_id", "classification");
CREATE INDEX "deliverable_reliability_profiles_company_id_reliability_band_idx"
  ON "deliverable_reliability_profiles"("company_id", "reliability_band");

ALTER TABLE "deliverable_reliability_profiles"
  ADD CONSTRAINT "deliverable_reliability_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
