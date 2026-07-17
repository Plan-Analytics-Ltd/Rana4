CREATE TABLE "engineering_knowledge_entries" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "fingerprint" VARCHAR(64) NOT NULL,
  "status" VARCHAR(32) NOT NULL,
  "last_action" VARCHAR(16),
  "concept" VARCHAR(256) NOT NULL,
  "discipline" VARCHAR(64),
  "engineering_object" VARCHAR(64),
  "engineering_work" VARCHAR(64),
  "deliverable_type" VARCHAR(64),
  "lifecycle_stage" VARCHAR(64),
  "aliases" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB NOT NULL DEFAULT '[]',
  "review_notes" TEXT,
  "reviewed_by" VARCHAR(255),
  "first_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "project_count" INTEGER NOT NULL DEFAULT 0,
  "successful_comparisons" INTEGER NOT NULL DEFAULT 0,
  "version_history" JSONB NOT NULL DEFAULT '[]',
  "brain_version" VARCHAR(64) NOT NULL,
  "prompt_version" VARCHAR(64) NOT NULL,
  "vocabulary_version" VARCHAR(64) NOT NULL,
  "validation_version" VARCHAR(64) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "engineering_knowledge_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engineering_knowledge_entries_company_id_fingerprint_key"
  ON "engineering_knowledge_entries"("company_id", "fingerprint");
CREATE INDEX "engineering_knowledge_entries_company_id_status_idx"
  ON "engineering_knowledge_entries"("company_id", "status");

ALTER TABLE "engineering_knowledge_entries"
  ADD CONSTRAINT "engineering_knowledge_entries_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
