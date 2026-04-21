-- AlterTable
ALTER TABLE "activities" ADD COLUMN "assigned_resources" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "deliverables" ADD COLUMN "assigned_resources" JSONB NOT NULL DEFAULT '[]';
