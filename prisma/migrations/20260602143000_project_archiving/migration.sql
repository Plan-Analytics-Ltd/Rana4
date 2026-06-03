-- Project soft-archiving (for excluding from similarity/portfolio matches)

ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "projects_company_id_archived_at_idx"
  ON "projects" ("company_id", "archived_at");

