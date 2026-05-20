-- Fragnet activity templates + deliverable inheritance fields

CREATE TABLE "fragnet_activity_templates" (
    "id" TEXT NOT NULL,
    "fragnet_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "template_code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "best_duration" INTEGER NOT NULL,
    "likely_duration" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "assigned_resources" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fragnet_activity_templates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "fragnet_template_relationships" (
    "id" TEXT NOT NULL,
    "fragnet_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "predecessor_template_id" TEXT NOT NULL,
    "successor_template_id" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "lag" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fragnet_template_relationships_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "activities" ADD COLUMN "is_inherited" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "activities" ADD COLUMN "template_activity_id" TEXT;
ALTER TABLE "activities" ADD COLUMN "detached_from_template" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "fragnet_activity_templates_id_company_id_key" ON "fragnet_activity_templates"("id", "company_id");
CREATE UNIQUE INDEX "fragnet_activity_templates_company_id_fragnet_id_template_code_key" ON "fragnet_activity_templates"("company_id", "fragnet_id", "template_code");
CREATE INDEX "fragnet_activity_templates_project_id_idx" ON "fragnet_activity_templates"("project_id");

CREATE UNIQUE INDEX "fragnet_template_relationships_id_company_id_key" ON "fragnet_template_relationships"("id", "company_id");
CREATE INDEX "fragnet_template_relationships_project_id_idx" ON "fragnet_template_relationships"("project_id");

CREATE INDEX "activities_template_activity_id_idx" ON "activities"("template_activity_id");

ALTER TABLE "fragnet_activity_templates" ADD CONSTRAINT "fragnet_activity_templates_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "fragnet_activity_templates" ADD CONSTRAINT "fragnet_activity_templates_fragnet_fk" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fragnet_activity_templates" ADD CONSTRAINT "fragnet_activity_templates_project_fk" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "fragnet_template_relationships" ADD CONSTRAINT "fragnet_template_relationships_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE "fragnet_template_relationships" ADD CONSTRAINT "fragnet_template_relationships_fragnet_fk" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fragnet_template_relationships" ADD CONSTRAINT "fragnet_template_relationships_project_fk" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
ALTER TABLE "fragnet_template_relationships" ADD CONSTRAINT "fragnet_template_relationships_pred_fk" FOREIGN KEY ("predecessor_template_id", "company_id") REFERENCES "fragnet_activity_templates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "fragnet_template_relationships" ADD CONSTRAINT "fragnet_template_relationships_succ_fk" FOREIGN KEY ("successor_template_id", "company_id") REFERENCES "fragnet_activity_templates"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activities" ADD CONSTRAINT "activities_template_fk" FOREIGN KEY ("template_activity_id", "company_id") REFERENCES "fragnet_activity_templates"("id", "company_id") ON DELETE SET NULL ON UPDATE CASCADE;
