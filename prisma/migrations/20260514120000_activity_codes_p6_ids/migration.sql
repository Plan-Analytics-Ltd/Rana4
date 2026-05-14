-- Activity code types (P6 ACTVTYPE) and values (ACTVCODE), assignments (TASKACTV), stable P6 numeric IDs.

CREATE TABLE "activity_code_types" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "slug" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(64),
    "seq_num" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_code_types_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_code_types_company_id_slug_key" ON "activity_code_types"("company_id", "slug");
CREATE INDEX "activity_code_types_company_id_idx" ON "activity_code_types"("company_id");

ALTER TABLE "activity_code_types" ADD CONSTRAINT "activity_code_types_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "activity_codes" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "name" VARCHAR(255) NOT NULL,
    "short_name" VARCHAR(64),
    "seq_num" INTEGER NOT NULL DEFAULT 0,
    "color" VARCHAR(32),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_codes_company_id_type_id_name_key" ON "activity_codes"("company_id", "type_id", "name");
CREATE INDEX "activity_codes_company_id_idx" ON "activity_codes"("company_id");
CREATE INDEX "activity_codes_type_id_idx" ON "activity_codes"("type_id");

ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_type_fk" FOREIGN KEY ("type_id") REFERENCES "activity_code_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "activity_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "activity_code_assignments" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "type_id" TEXT NOT NULL,
    "code_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "activity_code_assignments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_code_assignments_activity_id_type_id_key" ON "activity_code_assignments"("activity_id", "type_id");
CREATE INDEX "activity_code_assignments_company_id_idx" ON "activity_code_assignments"("company_id");
CREATE INDEX "activity_code_assignments_code_id_idx" ON "activity_code_assignments"("code_id");

ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_activity_fk" FOREIGN KEY ("activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_type_fk" FOREIGN KEY ("type_id") REFERENCES "activity_code_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_code_fk" FOREIGN KEY ("code_id") REFERENCES "activity_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

CREATE TABLE "p6_external_ids" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "entity_kind" VARCHAR(32) NOT NULL,
    "entity_key" VARCHAR(512) NOT NULL,
    "p6_numeric_id" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "p6_external_ids_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "p6_external_ids_company_project_kind_key_key" ON "p6_external_ids"("company_id", "project_id", "entity_kind", "entity_key");
CREATE INDEX "p6_external_ids_company_project_idx" ON "p6_external_ids"("company_id", "project_id");

ALTER TABLE "p6_external_ids" ADD CONSTRAINT "p6_external_ids_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "p6_external_ids" ADD CONSTRAINT "p6_external_ids_project_fk" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
