-- Run manually in Neon SQL editor ONLY if migrate deploy failed partway through
-- this migration, then: npx prisma migrate resolve --rolled-back 20260520140000_template_activity_code_assignments
-- and run npm run db:deploy again.

ALTER TABLE "activity_code_assignments" DROP CONSTRAINT IF EXISTS "activity_code_assignments_template_fk";
ALTER TABLE "activity_code_assignments" DROP INDEX IF EXISTS "activity_code_assignments_template_type_uq";
ALTER TABLE "activity_code_assignments" DROP COLUMN IF EXISTS "template_activity_id";

ALTER TABLE "activity_code_assignments" DROP CONSTRAINT IF EXISTS "activity_code_assignments_owner_chk";

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_owner_chk"
  CHECK (
    ("activity_id" IS NOT NULL AND "deliverable_id" IS NULL)
    OR ("activity_id" IS NULL AND "deliverable_id" IS NOT NULL)
  );
