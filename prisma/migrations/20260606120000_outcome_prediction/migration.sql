ALTER TYPE "LearnedInsightType" ADD VALUE 'OUTCOME_PREDICTION';

CREATE TABLE "deliverable_outcome_profiles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "classification" "DeliverableClassification" NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "project_count" INTEGER NOT NULL DEFAULT 0,
  "predicted_minimum_duration" DOUBLE PRECISION,
  "predicted_most_likely_duration" DOUBLE PRECISION,
  "predicted_maximum_duration" DOUBLE PRECISION,
  "historical_average_duration" DOUBLE PRECISION,
  "historical_median_duration" DOUBLE PRECISION,
  "historical_overrun_frequency" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "historical_average_variance_percent" DOUBLE PRECISION,
  "prediction_confidence_level" VARCHAR(16) NOT NULL DEFAULT 'LOW',
  "prediction_confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "reasoning_json" JSONB NOT NULL DEFAULT '[]',
  "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "deliverable_outcome_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deliverable_outcome_profiles_company_id_classification_key"
  ON "deliverable_outcome_profiles"("company_id", "classification");
CREATE INDEX "deliverable_outcome_profiles_company_id_prediction_confidence_level_idx"
  ON "deliverable_outcome_profiles"("company_id", "prediction_confidence_level");

ALTER TABLE "deliverable_outcome_profiles"
  ADD CONSTRAINT "deliverable_outcome_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
