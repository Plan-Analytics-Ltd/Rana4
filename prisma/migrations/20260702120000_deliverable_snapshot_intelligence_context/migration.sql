-- Phase 9.5: self-describing deliverable snapshots for historical fingerprint enrichment

ALTER TABLE "deliverable_snapshots"
  ADD COLUMN IF NOT EXISTS "fragnet_id" TEXT,
  ADD COLUMN IF NOT EXISTS "parent_wbs" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "wbs_path" VARCHAR(512),
  ADD COLUMN IF NOT EXISTS "stage" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "discipline" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "deliverable_snapshots_snapshot_id_fragnet_id_idx"
  ON "deliverable_snapshots" ("snapshot_id", "fragnet_id");
