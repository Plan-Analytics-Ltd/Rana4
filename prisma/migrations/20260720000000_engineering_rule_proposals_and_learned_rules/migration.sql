CREATE TABLE "engineering_rule_proposals" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "target_label" VARCHAR(128) NOT NULL,
  "proposed_pattern" TEXT NOT NULL,
  "rationale" TEXT NOT NULL,
  "supporting_fingerprints" JSONB NOT NULL DEFAULT '[]',
  "occurrences" INTEGER NOT NULL,
  "project_count" INTEGER NOT NULL,
  "confirmed_decision_count" INTEGER NOT NULL,
  "consistency" DOUBLE PRECISION NOT NULL,
  "confidence_score" DOUBLE PRECISION NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  "reviewed_by" VARCHAR(255),
  "review_notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" TIMESTAMP(3),

  CONSTRAINT "engineering_rule_proposals_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "engineering_learned_rules" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "target_id" VARCHAR(64) NOT NULL,
  "target_label" VARCHAR(128) NOT NULL,
  "pattern" TEXT NOT NULL,
  "source_proposal_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "engineering_learned_rules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "engineering_rule_proposals_company_id_kind_target_id_propos_key"
  ON "engineering_rule_proposals"("company_id", "kind", "target_id", "proposed_pattern");
CREATE INDEX "engineering_rule_proposals_company_id_status_idx"
  ON "engineering_rule_proposals"("company_id", "status");

CREATE INDEX "engineering_learned_rules_company_id_kind_active_idx"
  ON "engineering_learned_rules"("company_id", "kind", "active");

ALTER TABLE "engineering_rule_proposals"
  ADD CONSTRAINT "engineering_rule_proposals_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "engineering_learned_rules"
  ADD CONSTRAINT "engineering_learned_rules_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
