-- Company-based isolation reconciliation (idempotent, no data loss)
-- Phases:
-- 1) Structure (nullable)
-- 2) Backfill
-- 3) Enforce constraints

-- Step 1: companies table
CREATE TABLE IF NOT EXISTS "companies" (
  id   TEXT PRIMARY KEY,
  name TEXT NOT NULL
);

-- Step 2: default company
INSERT INTO "companies" (id, name)
VALUES ('default-company', 'Default Company')
ON CONFLICT (id) DO NOTHING;

-- Step 3: add company_id columns (nullable)
ALTER TABLE "activities"        ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "deliverables"      ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "fragnets"          ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "rate_card_entries" ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "relationships"     ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "standards"         ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "users"             ADD COLUMN IF NOT EXISTS "company_id" TEXT;
ALTER TABLE "assurance_notes"   ADD COLUMN IF NOT EXISTS "company_id" TEXT;

-- Step 4: backfill existing rows
UPDATE "activities"        SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "deliverables"      SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "fragnets"          SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "rate_card_entries" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "relationships"     SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "standards"         SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "users"             SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "assurance_notes"   SET "company_id" = 'default-company' WHERE "company_id" IS NULL;

-- Step 5: enforce NOT NULL (safe after backfill)
ALTER TABLE "activities"        ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "deliverables"      ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "fragnets"          ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "rate_card_entries" ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "relationships"     ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "standards"         ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "users"             ALTER COLUMN "company_id" SET NOT NULL;
ALTER TABLE "assurance_notes"   ALTER COLUMN "company_id" SET NOT NULL;

-- Step 6: foreign keys (Postgres has no ADD CONSTRAINT IF NOT EXISTS; use catalog checks)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'activities_company_fk') THEN
    ALTER TABLE "activities"
      ADD CONSTRAINT "activities_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deliverables_company_fk') THEN
    ALTER TABLE "deliverables"
      ADD CONSTRAINT "deliverables_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fragnets_company_fk') THEN
    ALTER TABLE "fragnets"
      ADD CONSTRAINT "fragnets_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rate_card_entries_company_fk') THEN
    ALTER TABLE "rate_card_entries"
      ADD CONSTRAINT "rate_card_entries_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'relationships_company_fk') THEN
    ALTER TABLE "relationships"
      ADD CONSTRAINT "relationships_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'standards_company_fk') THEN
    ALTER TABLE "standards"
      ADD CONSTRAINT "standards_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_company_fk') THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'assurance_notes_company_fk') THEN
    ALTER TABLE "assurance_notes"
      ADD CONSTRAINT "assurance_notes_company_fk"
      FOREIGN KEY ("company_id") REFERENCES "companies"(id);
  END IF;
END $$;

