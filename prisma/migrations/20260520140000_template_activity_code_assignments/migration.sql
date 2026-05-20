-- P6 activity code assignments on fragnet default activities (templates).

ALTER TABLE "activity_code_assignments" ADD COLUMN IF NOT EXISTS "template_activity_id" TEXT;

ALTER TABLE "activity_code_assignments" DROP CONSTRAINT IF EXISTS "activity_code_assignments_owner_chk";

ALTER TABLE "activity_code_assignments" DROP CONSTRAINT IF EXISTS "activity_code_assignments_template_fk";

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_template_fk"
  FOREIGN KEY ("template_activity_id", "company_id") REFERENCES "fragnet_activity_templates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_owner_chk"
  CHECK (
    ("activity_id" IS NOT NULL AND "deliverable_id" IS NULL AND "template_activity_id" IS NULL)
    OR ("activity_id" IS NULL AND "deliverable_id" IS NOT NULL AND "template_activity_id" IS NULL)
    OR ("activity_id" IS NULL AND "deliverable_id" IS NULL AND "template_activity_id" IS NOT NULL)
  );

CREATE UNIQUE INDEX IF NOT EXISTS "activity_code_assignments_template_type_uq"
  ON "activity_code_assignments" ("template_activity_id", "type_id")
  WHERE "template_activity_id" IS NOT NULL;
