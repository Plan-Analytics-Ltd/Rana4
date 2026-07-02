-- Phase 10: canonical planner-equivalent work-package duration on historical snapshots
-- Backward compatible: nullable columns, existing rows backfilled by historical repair.

ALTER TABLE "deliverable_snapshots"
  ADD COLUMN IF NOT EXISTS "work_package_duration_days" INTEGER,
  ADD COLUMN IF NOT EXISTS "duration_basis" VARCHAR(32);
