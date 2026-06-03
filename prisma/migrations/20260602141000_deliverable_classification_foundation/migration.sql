-- Deliverable classification foundation (normalized business categories)

DO $$ BEGIN
  CREATE TYPE "DeliverableClassification" AS ENUM (
    'DESIGN',
    'REVIEW',
    'CLIENT_APPROVAL',
    'TECHNICAL_ASSURANCE',
    'COORDINATION',
    'PROCUREMENT',
    'CONSTRUCTION',
    'COMMISSIONING',
    'HANDOVER',
    'REGULATORY_APPROVAL',
    'QUALITY_ASSURANCE',
    'INFORMATION_ISSUE',
    'OTHER'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "deliverables"
  ADD COLUMN IF NOT EXISTS "classification" "DeliverableClassification";

ALTER TABLE "deliverable_snapshots"
  ADD COLUMN IF NOT EXISTS "classification" "DeliverableClassification";

CREATE INDEX IF NOT EXISTS "deliverables_company_id_classification_idx"
  ON "deliverables" ("company_id", "classification");

