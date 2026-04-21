/*
  Warnings:

  - A unique constraint covering the columns `[id,company_id]` on the table `activities` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[company_id,fragnet_id,activity_code]` on the table `activities` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,company_id]` on the table `assurance_notes` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,company_id]` on the table `deliverables` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,company_id]` on the table `fragnets` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[id,company_id]` on the table `standards` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `company_id` to the `activities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `assurance_notes` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `deliverables` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `fragnets` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `rate_card_entries` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `relationships` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `standards` table without a default value. This is not possible if the table is not empty.
  - Added the required column `company_id` to the `users` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_assurance_note_id_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_deliverable_id_fkey";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_fragnet_id_fkey";

-- DropForeignKey
ALTER TABLE "assurance_notes" DROP CONSTRAINT "assurance_notes_standard_id_fkey";

-- DropForeignKey
ALTER TABLE "deliverables" DROP CONSTRAINT "deliverables_fragnet_id_fkey";

-- DropForeignKey
ALTER TABLE "fragnets" DROP CONSTRAINT "fragnets_standard_id_fkey";

-- DropForeignKey
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_fragnet_id_fkey";

-- DropForeignKey
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_predecessor_activity_id_fkey";

-- DropForeignKey
ALTER TABLE "relationships" DROP CONSTRAINT "relationships_successor_activity_id_fkey";

-- DropIndex
DROP INDEX "activities_deliverable_id_idx";

-- DropIndex
DROP INDEX "activities_fragnet_id_activity_code_key";

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "assurance_notes" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "deliverables" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "fragnets" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "rate_card_entries" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "relationships" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "standards" ADD COLUMN     "company_id" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "company_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "activities_id_company_id_key" ON "activities"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_company_id_fragnet_id_activity_code_key" ON "activities"("company_id", "fragnet_id", "activity_code");

-- CreateIndex
CREATE UNIQUE INDEX "assurance_notes_id_company_id_key" ON "assurance_notes"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_id_company_id_key" ON "deliverables"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "fragnets_id_company_id_key" ON "fragnets"("id", "company_id");

-- CreateIndex
CREATE UNIQUE INDEX "standards_id_company_id_key" ON "standards"("id", "company_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "rate_card_entries" ADD CONSTRAINT "rate_card_entries_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "standards" ADD CONSTRAINT "standards_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assurance_notes" ADD CONSTRAINT "assurance_notes_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "assurance_notes" ADD CONSTRAINT "assurance_notes_standard_id_company_id_fkey" FOREIGN KEY ("standard_id", "company_id") REFERENCES "standards"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fragnets" ADD CONSTRAINT "fragnets_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "fragnets" ADD CONSTRAINT "fragnets_standard_id_company_id_fkey" FOREIGN KEY ("standard_id", "company_id") REFERENCES "standards"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_assurance_note_id_company_id_fkey" FOREIGN KEY ("assurance_note_id", "company_id") REFERENCES "assurance_notes"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_deliverable_id_company_id_fkey" FOREIGN KEY ("deliverable_id", "company_id") REFERENCES "deliverables"("id", "company_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_predecessor_activity_id_company_id_fkey" FOREIGN KEY ("predecessor_activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "relationships" ADD CONSTRAINT "relationships_successor_activity_id_company_id_fkey" FOREIGN KEY ("successor_activity_id", "company_id") REFERENCES "activities"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_fragnet_id_company_id_fkey" FOREIGN KEY ("fragnet_id", "company_id") REFERENCES "fragnets"("id", "company_id") ON DELETE CASCADE ON UPDATE CASCADE;
