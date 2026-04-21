-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'ACTIVE', 'LOCKED');

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "details" JSONB NOT NULL DEFAULT '{}';
