-- CreateTable
CREATE TABLE "deliverable_relationships" (
    "id" UUID NOT NULL,
    "fragnet_id" UUID NOT NULL,
    "predecessor_deliverable_id" UUID NOT NULL,
    "successor_deliverable_id" UUID NOT NULL,
    "relationship_type" "RelationshipType" NOT NULL,
    "lag" INTEGER NOT NULL DEFAULT 0,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "deliverable_relationships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "deliverable_relationships_project_id_idx" ON "deliverable_relationships"("project_id");

-- CreateIndex
CREATE INDEX "deliverable_relationships_fragnet_id_idx" ON "deliverable_relationships"("fragnet_id");

-- AddForeignKey
ALTER TABLE "deliverable_relationships" ADD CONSTRAINT "deliverable_relationships_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverable_relationships" ADD CONSTRAINT "deliverable_relationships_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_relationships" ADD CONSTRAINT "deliverable_relationships_predecessor_deliverable_id_company_id_fkey" FOREIGN KEY ("predecessor_deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_relationships" ADD CONSTRAINT "deliverable_relationships_successor_deliverable_id_company_id_fkey" FOREIGN KEY ("successor_deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_relationships" ADD CONSTRAINT "deliverable_relationships_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE NO ACTION;
