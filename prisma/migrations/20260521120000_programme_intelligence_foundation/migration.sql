-- Programme Intelligence Foundation: snapshots, metadata, portfolio learning

CREATE TYPE "ProgrammeSnapshotSourceType" AS ENUM (
  'RANA4_EXPORT',
  'XER_IMPORT',
  'LIVE_UPDATE',
  'AS_BUILT',
  'BASELINE_GENERATED'
);

CREATE TYPE "ProgrammeSnapshotRole" AS ENUM (
  'BASELINE',
  'LIVE_IMPORT',
  'AS_BUILT',
  'COMPARISON'
);

CREATE TABLE "project_intelligence_profiles" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "project_type" VARCHAR(64),
  "primary_riba_stage" VARCHAR(32),
  "complexity_score" DOUBLE PRECISION,
  "classification_tags" JSONB NOT NULL DEFAULT '{}',
  "complexity_metrics" JSONB NOT NULL DEFAULT '{}',
  "updated_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_intelligence_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_intelligence_profiles_project_id_key" ON "project_intelligence_profiles"("project_id");
CREATE INDEX "project_intelligence_profiles_company_id_idx" ON "project_intelligence_profiles"("company_id");
CREATE INDEX "project_intelligence_profiles_company_id_project_type_idx" ON "project_intelligence_profiles"("company_id", "project_type");

ALTER TABLE "project_intelligence_profiles" ADD CONSTRAINT "project_intelligence_profiles_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "programme_snapshots" (
  "id" TEXT NOT NULL,
  "project_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "source_type" "ProgrammeSnapshotSourceType" NOT NULL,
  "snapshot_role" "ProgrammeSnapshotRole",
  "schedule_date" DATE,
  "created_by_user_id" TEXT,
  "snapshot_version" INTEGER NOT NULL DEFAULT 1,
  "label" VARCHAR(255),
  "source_file_name" VARCHAR(512),
  "metrics" JSONB NOT NULL DEFAULT '{}',
  "import_summary" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "programme_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "programme_snapshots_project_id_imported_at_idx" ON "programme_snapshots"("project_id", "imported_at");
CREATE INDEX "programme_snapshots_company_id_imported_at_idx" ON "programme_snapshots"("company_id", "imported_at");
CREATE INDEX "programme_snapshots_company_id_source_type_idx" ON "programme_snapshots"("company_id", "source_type");

ALTER TABLE "programme_snapshots" ADD CONSTRAINT "programme_snapshots_project_id_company_id_fkey"
  FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "programme_snapshots" ADD CONSTRAINT "programme_snapshots_company_fk"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

CREATE TABLE "activity_snapshots" (
  "id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "activity_id" TEXT,
  "activity_code" VARCHAR(100) NOT NULL,
  "deliverable_id" TEXT,
  "fragnet_id" TEXT,
  "name" VARCHAR(255),
  "original_duration" INTEGER,
  "remaining_duration" INTEGER,
  "actual_duration" INTEGER,
  "percent_complete" DOUBLE PRECISION,
  "start_date" DATE,
  "finish_date" DATE,
  "early_start" DATE,
  "early_finish" DATE,
  "late_start" DATE,
  "late_finish" DATE,
  "total_float" INTEGER,
  "free_float" INTEGER,
  "is_critical" BOOLEAN NOT NULL DEFAULT false,
  "status" VARCHAR(32),
  "classification_tags" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "activity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_snapshots_snapshot_id_idx" ON "activity_snapshots"("snapshot_id");
CREATE INDEX "activity_snapshots_snapshot_id_activity_code_idx" ON "activity_snapshots"("snapshot_id", "activity_code");
CREATE INDEX "activity_snapshots_activity_id_idx" ON "activity_snapshots"("activity_id");

ALTER TABLE "activity_snapshots" ADD CONSTRAINT "activity_snapshots_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "programme_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "deliverable_snapshots" (
  "id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "deliverable_id" TEXT,
  "name" VARCHAR(255) NOT NULL,
  "planned_start" DATE,
  "planned_finish" DATE,
  "actual_start" DATE,
  "actual_finish" DATE,
  "total_float" INTEGER,
  "status" VARCHAR(32),
  "classification_tags" JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT "deliverable_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "deliverable_snapshots_snapshot_id_idx" ON "deliverable_snapshots"("snapshot_id");
CREATE INDEX "deliverable_snapshots_deliverable_id_idx" ON "deliverable_snapshots"("deliverable_id");

ALTER TABLE "deliverable_snapshots" ADD CONSTRAINT "deliverable_snapshots_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "programme_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "relationship_snapshots" (
  "id" TEXT NOT NULL,
  "snapshot_id" TEXT NOT NULL,
  "predecessor_activity_code" VARCHAR(100) NOT NULL,
  "successor_activity_code" VARCHAR(100) NOT NULL,
  "relationship_type" "RelationshipType" NOT NULL,
  "lag" INTEGER NOT NULL DEFAULT 0,
  "matched_relationship_id" TEXT,
  CONSTRAINT "relationship_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "relationship_snapshots_snapshot_id_idx" ON "relationship_snapshots"("snapshot_id");

ALTER TABLE "relationship_snapshots" ADD CONSTRAINT "relationship_snapshots_snapshot_id_fkey"
  FOREIGN KEY ("snapshot_id") REFERENCES "programme_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "intelligence_findings" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "finding_type" VARCHAR(64) NOT NULL,
  "category" VARCHAR(64) NOT NULL,
  "severity" VARCHAR(16) NOT NULL DEFAULT 'info',
  "title" VARCHAR(512) NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence" JSONB NOT NULL DEFAULT '{}',
  "tags" JSONB NOT NULL DEFAULT '[]',
  "sample_size" INTEGER NOT NULL DEFAULT 0,
  "confidence" DOUBLE PRECISION,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "valid_until" TIMESTAMP(3),
  CONSTRAINT "intelligence_findings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "intelligence_findings_company_id_finding_type_idx" ON "intelligence_findings"("company_id", "finding_type");
CREATE INDEX "intelligence_findings_company_id_generated_at_idx" ON "intelligence_findings"("company_id", "generated_at");

ALTER TABLE "intelligence_findings" ADD CONSTRAINT "intelligence_findings_company_id_fkey"
  FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
