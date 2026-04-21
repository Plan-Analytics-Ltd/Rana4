/*
  Warnings:

  - Changed the type of `role` on the `project_members` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');

-- AlterTable
ALTER TABLE "project_members" ADD COLUMN "role_new" "ProjectRole";

UPDATE "project_members"
SET "role_new" = CASE
  WHEN "role" = 'ADMIN' THEN 'ADMIN'::"ProjectRole"
  WHEN "role" = 'MEMBER' THEN 'VIEWER'::"ProjectRole"
  ELSE NULL
END;

ALTER TABLE "project_members" ALTER COLUMN "role_new" SET NOT NULL;

ALTER TABLE "project_members" DROP COLUMN "role";
ALTER TABLE "project_members" RENAME COLUMN "role_new" TO "role";
