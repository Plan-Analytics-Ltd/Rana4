CREATE TYPE "TrustBand" AS ENUM (
  'HIGH_TRUST',
  'MODERATE_TRUST',
  'LIMITED_TRUST',
  'INSUFFICIENT_EVIDENCE'
);

CREATE TABLE "intelligence_trust_profiles" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "classification" "DeliverableClassification" NOT NULL,
  "label" VARCHAR(128) NOT NULL,
  "trust_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "trust_band" "TrustBand" NOT NULL DEFAULT 'INSUFFICIENT_EVIDENCE',
  "trust_label" VARCHAR(64) NOT NULL DEFAULT 'Insufficient Evidence',
  "evidence_strength_json" JSONB NOT NULL DEFAULT '{}',
  "knowledge_coverage_json" JSONB NOT NULL DEFAULT '{}',
  "recommendation_traceability_json" JSONB NOT NULL DEFAULT '{}',
  "why_seeing_this_json" JSONB NOT NULL DEFAULT '[]',
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "project_count" INTEGER NOT NULL DEFAULT 0,
  "layers_available" INTEGER NOT NULL DEFAULT 0,
  "last_updated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "intelligence_trust_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intelligence_trust_profiles_company_id_classification_key"
  ON "intelligence_trust_profiles"("company_id", "classification");
CREATE INDEX "intelligence_trust_profiles_company_id_trust_band_idx"
  ON "intelligence_trust_profiles"("company_id", "trust_band");

ALTER TABLE "intelligence_trust_profiles"
  ADD CONSTRAINT "intelligence_trust_profiles_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
