-- Allow activity code assignments on deliverables (exported as TASK rows) and keep activity assignments.
-- Exactly one of activity_id or deliverable_id must be set (CHECK + partial unique indexes).

DROP INDEX IF EXISTS "activity_code_assignments_activity_id_type_id_key";

ALTER TABLE "activity_code_assignments" ADD COLUMN "deliverable_id" TEXT;

ALTER TABLE "activity_code_assignments" ALTER COLUMN "activity_id" DROP NOT NULL;

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_deliverable_fk"
  FOREIGN KEY ("deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_owner_chk"
  CHECK (
    ("activity_id" IS NOT NULL AND "deliverable_id" IS NULL)
    OR ("activity_id" IS NULL AND "deliverable_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX "activity_code_assignments_activity_type_uq"
  ON "activity_code_assignments" ("activity_id", "type_id")
  WHERE "activity_id" IS NOT NULL;

CREATE UNIQUE INDEX "activity_code_assignments_deliverable_type_uq"
  ON "activity_code_assignments" ("deliverable_id", "type_id")
  WHERE "deliverable_id" IS NOT NULL;

CREATE INDEX "activity_code_assignments_deliverable_id_idx" ON "activity_code_assignments" ("deliverable_id");
