-- Programme Intelligence: snapshot metadata + enhanced intelligence profile

-- 1) Snapshot programme state enum
DO $$ BEGIN
  CREATE TYPE "ProgrammeState" AS ENUM (
    'BASELINE',
    'APPROVED_BASELINE',
    'LIVE_UPDATE',
    'RECOVERY_PROGRAMME',
    'AS_BUILT',
    'FINAL_AS_BUILT'
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 2) Extend programme_snapshots with nullable metadata fields (backwards compatible)
ALTER TABLE "programme_snapshots"
  ADD COLUMN IF NOT EXISTS "programme_state" "ProgrammeState",
  ADD COLUMN IF NOT EXISTS "import_confidence_level" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "import_confidence_score" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "sector" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "project_type" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "procurement_route" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "stage" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "region" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "client_type" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "complexity" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "discipline_tags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "project_tags" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "classification_tags_list" JSONB NOT NULL DEFAULT '[]';

-- 3) Enhance project_intelligence_profiles to be canonical structured metadata
ALTER TABLE "project_intelligence_profiles"
  ADD COLUMN IF NOT EXISTS "sector" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "procurement_route" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "stage" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "region" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "client_type" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "complexity" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "classification_tags_list" JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "discipline_tags" JSONB NOT NULL DEFAULT '[]';

-- Helpful indexes for similarity queries (optional)
CREATE INDEX IF NOT EXISTS "programme_snapshots_company_id_programme_state_idx"
  ON "programme_snapshots" ("company_id", "programme_state");

CREATE INDEX IF NOT EXISTS "project_intelligence_profiles_company_id_sector_idx"
  ON "project_intelligence_profiles" ("company_id", "sector");

