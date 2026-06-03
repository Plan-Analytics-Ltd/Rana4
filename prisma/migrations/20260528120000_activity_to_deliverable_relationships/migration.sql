-- Shared activity → linked deliverable FS links (activity predecessor, deliverable successor)

CREATE TABLE "activity_to_deliverable_relationships" (
    "id" TEXT NOT NULL,
    "fragnet_id" TEXT NOT NULL,
    "predecessor_activity_id" TEXT NOT NULL,
    "successor_deliverable_id" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "lag" INTEGER NOT NULL DEFAULT 0,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "activity_to_deliverable_relationships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "activity_to_deliverable_relationships_fragnet_id_predecessor_activity_id_successor_deliverable_id_relationship_type_key" ON "activity_to_deliverable_relationships"("fragnet_id", "predecessor_activity_id", "successor_deliverable_id", "relationship_type");

CREATE INDEX "activity_to_deliverable_relationships_project_id_idx" ON "activity_to_deliverable_relationships"("project_id");

CREATE INDEX "activity_to_deliverable_relationships_fragnet_id_idx" ON "activity_to_deliverable_relationships"("fragnet_id");

ALTER TABLE "activity_to_deliverable_relationships" ADD CONSTRAINT "activity_to_deliverable_relationships_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "activity_to_deliverable_relationships" ADD CONSTRAINT "activity_to_deliverable_relationships_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_to_deliverable_relationships" ADD CONSTRAINT "activity_to_deliverable_relationships_predecessor_activity_id_company_id_fkey" FOREIGN KEY ("predecessor_activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_to_deliverable_relationships" ADD CONSTRAINT "activity_to_deliverable_relationships_successor_deliverable_id_company_id_fkey" FOREIGN KEY ("successor_deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "activity_to_deliverable_relationships" ADD CONSTRAINT "activity_to_deliverable_relationships_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
