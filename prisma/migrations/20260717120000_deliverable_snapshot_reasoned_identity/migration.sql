-- Phase 2: store pre-computed Engineering Reasoning identity on deliverable snapshots.
-- All columns nullable — null means "fall back to rule-based identity, unchanged".
ALTER TABLE "deliverable_snapshots"
  ADD COLUMN "reasoned_discipline" VARCHAR(64),
  ADD COLUMN "reasoned_engineering_object" VARCHAR(64),
  ADD COLUMN "reasoned_engineering_work" VARCHAR(64),
  ADD COLUMN "reasoned_deliverable_type" VARCHAR(64),
  ADD COLUMN "reasoned_lifecycle_stage" VARCHAR(64),
  ADD COLUMN "reasoning_source" VARCHAR(16),
  ADD COLUMN "reasoning_computed_at" TIMESTAMP(3);
