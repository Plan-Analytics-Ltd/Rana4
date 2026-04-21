-- Backfill script for adding company-based isolation.
-- 1) Create default company
-- 2) Assign all existing rows to it
--
-- Run this after applying the migration that adds `company_id` columns (nullable),
-- then run a follow-up migration (or SQL) to enforce NOT NULL.

INSERT INTO "companies" ("id", "name")
VALUES ('default-company', 'Default Company')
ON CONFLICT ("id") DO NOTHING;

UPDATE "users" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "rate_card_entries" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "standards" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "assurance_notes" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "fragnets" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "deliverables" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "activities" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;
UPDATE "relationships" SET "company_id" = 'default-company' WHERE "company_id" IS NULL;

