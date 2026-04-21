-- WBS stage 1: Deliverable.project_id (optional), Activity.deliverable_id (required, FK).

-- AlterTable
ALTER TABLE "deliverables" ADD COLUMN IF NOT EXISTS "project_id" VARCHAR(255);

-- AlterTable
ALTER TABLE "activities" ADD COLUMN IF NOT EXISTS "deliverable_id" TEXT;

-- Ensure each fragnet that has activities has at least one deliverable linked to that fragnet.
INSERT INTO "deliverables" ("id", "name", "project_id", "best_duration", "likely_duration", "assigned_resources", "fragnet_id", "created_at")
SELECT gen_random_uuid()::text, '[Migration] Default WBS', NULL, 1, 1, '[]'::jsonb, f."id", CURRENT_TIMESTAMP
FROM "fragnets" f
WHERE EXISTS (SELECT 1 FROM "activities" a WHERE a."fragnet_id" = f."id")
  AND NOT EXISTS (SELECT 1 FROM "deliverables" d WHERE d."fragnet_id" = f."id");

-- Backfill activities: pick earliest deliverable for the same fragnet (migration default or existing).
UPDATE "activities" a
SET "deliverable_id" = (
  SELECT d."id"
  FROM "deliverables" d
  WHERE d."fragnet_id" = a."fragnet_id"
  ORDER BY d."created_at" ASC
  LIMIT 1
)
WHERE a."deliverable_id" IS NULL;

-- Fail loudly if any row could not be assigned (should not happen after INSERT above).
ALTER TABLE "activities" ALTER COLUMN "deliverable_id" SET NOT NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "activities_deliverable_id_idx" ON "activities"("deliverable_id");

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deliverable_id_fkey" FOREIGN KEY ("deliverable_id") REFERENCES "deliverables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
