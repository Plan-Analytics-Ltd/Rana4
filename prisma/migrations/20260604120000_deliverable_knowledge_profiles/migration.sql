CREATE TYPE "LearningMaturity" AS ENUM ('WELL_KNOWN', 'MODERATE', 'LIMITED');

CREATE TABLE "deliverable_knowledge_profiles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "classification" "DeliverableClassification" NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "project_count" INTEGER NOT NULL DEFAULT 0,
  "average_duration" DOUBLE PRECISION,
  "median_duration" DOUBLE PRECISION,
  "minimum_duration" DOUBLE PRECISION,
  "maximum_duration" DOUBLE PRECISION,
  "standard_deviation" DOUBLE PRECISION,
  "predictability_score" DOUBLE PRECISION,
  "confidence_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "confidence_level" VARCHAR(16) NOT NULL DEFAULT 'LOW',
  "learning_maturity" "LearningMaturity" NOT NULL DEFAULT 'LIMITED',
  "evidence_volume" INTEGER NOT NULL DEFAULT 0,
  "coverage_score" DOUBLE PRECISION,
  "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "deliverable_knowledge_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deliverable_knowledge_profiles_company_id_classification_key"
  ON "deliverable_knowledge_profiles"("company_id", "classification");
CREATE INDEX "deliverable_knowledge_profiles_company_id_learning_maturity_idx"
  ON "deliverable_knowledge_profiles"("company_id", "learning_maturity");

ALTER TABLE "deliverable_knowledge_profiles"
  ADD CONSTRAINT "deliverable_knowledge_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
