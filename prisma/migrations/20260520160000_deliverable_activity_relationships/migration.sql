-- Deliverable summary → activity links (P6 export parity).
CREATE TABLE "deliverable_activity_relationships" (
    "id" TEXT NOT NULL,
    "fragnet_id" TEXT NOT NULL,
    "predecessor_deliverable_id" TEXT NOT NULL,
    "successor_activity_id" TEXT NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "lag" INTEGER NOT NULL DEFAULT 0,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "deliverable_activity_relationships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "deliverable_activity_relationships_fragnet_id_predecessor_deliverable_id_successor_activity_id_relationship_type_key" ON "deliverable_activity_relationships"("fragnet_id", "predecessor_deliverable_id", "successor_activity_id", "relationship_type");

CREATE INDEX "deliverable_activity_relationships_project_id_idx" ON "deliverable_activity_relationships"("project_id");

CREATE INDEX "deliverable_activity_relationships_fragnet_id_idx" ON "deliverable_activity_relationships"("fragnet_id");

ALTER TABLE "deliverable_activity_relationships" ADD CONSTRAINT "deliverable_activity_relationships_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "deliverable_activity_relationships" ADD CONSTRAINT "deliverable_activity_relationships_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deliverable_activity_relationships" ADD CONSTRAINT "deliverable_activity_relationships_predecessor_deliverable_id_company_id_fkey" FOREIGN KEY ("predecessor_deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deliverable_activity_relationships" ADD CONSTRAINT "deliverable_activity_relationships_successor_activity_id_company_id_fkey" FOREIGN KEY ("successor_activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "deliverable_activity_relationships" ADD CONSTRAINT "deliverable_activity_relationships_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
