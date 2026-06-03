-- Shared activities across multiple deliverables.

ALTER TABLE "fragnet_activity_templates"
  ADD COLUMN "is_shared_across_deliverables" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "activities"
  ADD COLUMN "is_shared_across_deliverables" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "activity_deliverables" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "deliverable_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_deliverables_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_deliverables_activity_id_deliverable_id_key"
  ON "activity_deliverables"("activity_id", "deliverable_id");

CREATE INDEX "activity_deliverables_deliverable_id_idx"
  ON "activity_deliverables"("deliverable_id");

CREATE INDEX "activity_deliverables_project_id_idx"
  ON "activity_deliverables"("project_id");

ALTER TABLE "activity_deliverables"
  ADD CONSTRAINT "activity_deliverables_company_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "activity_deliverables"
  ADD CONSTRAINT "activity_deliverables_activity_id_company_id_fkey"
  FOREIGN KEY ("activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_deliverables"
  ADD CONSTRAINT "activity_deliverables_deliverable_id_company_id_fkey"
  FOREIGN KEY ("deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_deliverables"
  ADD CONSTRAINT "activity_deliverables_project_id_company_id_fkey"
  FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

INSERT INTO "activity_deliverables" (
  "id",
  "activity_id",
  "deliverable_id",
  "project_id",
  "company_id",
  "is_primary",
  "created_at",
  "updated_at"
)
SELECT
  "id" || '_primary_link',
  "id",
  "deliverable_id",
  "project_id",
  "company_id",
  true,
  "created_at",
  CURRENT_TIMESTAMP
FROM "activities";
