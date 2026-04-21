-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'VIEWER';

-- AlterTable
ALTER TABLE "companies" ADD COLUMN "join_code" VARCHAR(32);

UPDATE "companies"
SET "join_code" = upper(replace(gen_random_uuid()::text, '-', ''))
WHERE "join_code" IS NULL;

ALTER TABLE "companies" ALTER COLUMN "join_code" SET NOT NULL;

CREATE UNIQUE INDEX "companies_join_code_key" ON "companies"("join_code");
