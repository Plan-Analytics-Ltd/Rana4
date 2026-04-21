/*
  Warnings:

  - Added the required column `project_id` to the `activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `project_id` to the `assurance_notes` table without a default value. This is not possible if the table is not empty.
  - Made the column `project_id` on table `deliverables` required. This step will fail if there are existing NULL values in that column.
  - Added the required column `project_id` to the `fragnets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `project_id` to the `relationships` table without a default value. This is not possible if the table is not empty.
  - Added the required column `project_id` to the `standards` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "project_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "assurance_notes" ADD COLUMN     "project_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "deliverables" ADD COLUMN     "external_project_id" VARCHAR(255),
ALTER COLUMN "project_id" SET NOT NULL,
ALTER COLUMN "project_id" SET DATA TYPE TEXT;

-- AlterTable
ALTER TABLE "fragnets" ADD COLUMN     "project_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "relationships" ADD COLUMN     "project_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "standards" ADD COLUMN     "project_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "company_id" TEXT NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_company_id_idx" ON "projects"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_id_company_id_key" ON "projects"("id", "company_id");

-- CreateIndex
CREATE INDEX "project_members_project_id_idx" ON "project_members"("project_id");

-- CreateIndex
CREATE INDEX "project_members_user_id_idx" ON "project_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_members_user_id_project_id_key" ON "project_members"("user_id", "project_id");

-- CreateIndex
CREATE INDEX "activities_project_id_idx" ON "activities"("project_id");

-- CreateIndex
CREATE INDEX "assurance_notes_project_id_idx" ON "assurance_notes"("project_id");

-- CreateIndex
CREATE INDEX "deliverables_project_id_idx" ON "deliverables"("project_id");

-- CreateIndex
CREATE INDEX "fragnets_project_id_idx" ON "fragnets"("project_id");

-- CreateIndex
CREATE INDEX "relationships_project_id_idx" ON "relationships"("project_id");

-- CreateIndex
CREATE INDEX "standards_project_id_idx" ON "standards"("project_id");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "standards" ADD CONSTRAINT "standards_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assurance_notes" ADD CONSTRAINT "assurance_notes_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fragnets" ADD CONSTRAINT "fragnets_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_project_id_company_id_fkey" FOREIGN KEY ("project_id", "company_id") REFERENCES "projects"("id", "company_id") ON DELETE NO ACTION ON UPDATE CASCADE;
