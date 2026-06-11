CREATE TYPE "RecommendationType" AS ENUM (
  'DURATION_REVIEW',
  'OPTIMISM_RISK',
  'LOW_CONFIDENCE',
  'HIGH_VARIABILITY',
  'STRONG_ALIGNMENT'
);

CREATE TABLE "recommendation_profiles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "classification" "DeliverableClassification" NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "recommendation_type" "RecommendationType" NOT NULL,
  "title" VARCHAR(512) NOT NULL,
  "summary" TEXT NOT NULL,
  "recommendation" TEXT NOT NULL,
  "severity" VARCHAR(16) NOT NULL DEFAULT 'MEDIUM',
  "confidence_level" VARCHAR(16) NOT NULL DEFAULT 'LOW',
  "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "evidence_count" INTEGER NOT NULL DEFAULT 0,
  "supporting_evidence_json" JSONB NOT NULL DEFAULT '[]',
  "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "recommendation_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "recommendation_profiles_company_id_classification_recommendation_type_key"
  ON "recommendation_profiles"("company_id", "classification", "recommendation_type");
CREATE INDEX "recommendation_profiles_company_id_recommendation_type_idx"
  ON "recommendation_profiles"("company_id", "recommendation_type");

ALTER TABLE "recommendation_profiles"
  ADD CONSTRAINT "recommendation_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
