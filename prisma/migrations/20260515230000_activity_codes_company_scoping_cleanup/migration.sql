/*
  Warnings:

  - You are about to drop the `access_requests` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `company_resource_sequences` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `rate_card_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `resource_registry` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "activity_code_assignments" DROP CONSTRAINT "activity_code_assignments_company_fk";

-- DropForeignKey
ALTER TABLE "activity_code_types" DROP CONSTRAINT "activity_code_types_company_fk";

-- DropForeignKey
ALTER TABLE "activity_codes" DROP CONSTRAINT "activity_codes_company_fk";

-- DropForeignKey
ALTER TABLE "p6_external_ids" DROP CONSTRAINT "p6_external_ids_company_fk";

-- DropForeignKey
ALTER TABLE "rate_card_entries" DROP CONSTRAINT "rate_card_entries_company_fk";

-- DropTable
DROP TABLE "access_requests";

-- DropTable
DROP TABLE "company_resource_sequences";

-- DropTable
DROP TABLE "rate_card_entries";

-- DropTable
DROP TABLE "resource_registry";

-- RenameForeignKey
ALTER TABLE "activity_code_assignments" RENAME CONSTRAINT "activity_code_assignments_activity_fk" TO "activity_code_assignments_activity_id_company_id_fkey";

-- RenameForeignKey
ALTER TABLE "activity_code_assignments" RENAME CONSTRAINT "activity_code_assignments_code_fk" TO "activity_code_assignments_code_id_fkey";

-- RenameForeignKey
ALTER TABLE "activity_code_assignments" RENAME CONSTRAINT "activity_code_assignments_type_fk" TO "activity_code_assignments_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "activity_codes" RENAME CONSTRAINT "activity_codes_parent_fk" TO "activity_codes_parent_id_fkey";

-- RenameForeignKey
ALTER TABLE "activity_codes" RENAME CONSTRAINT "activity_codes_type_fk" TO "activity_codes_type_id_fkey";

-- RenameForeignKey
ALTER TABLE "p6_external_ids" RENAME CONSTRAINT "p6_external_ids_project_fk" TO "p6_external_ids_project_id_company_id_fkey";

-- AddForeignKey
ALTER TABLE "activity_code_types" ADD CONSTRAINT "activity_code_types_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_codes" ADD CONSTRAINT "activity_codes_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "activity_code_assignments" ADD CONSTRAINT "activity_code_assignments_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "p6_external_ids" ADD CONSTRAINT "p6_external_ids_company_fk" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- RenameIndex
ALTER INDEX "p6_external_ids_company_project_idx" RENAME TO "p6_external_ids_company_id_project_id_idx";

-- RenameIndex
ALTER INDEX "p6_external_ids_company_project_kind_key_key" RENAME TO "p6_external_ids_company_id_project_id_entity_kind_entity_ke_key";
