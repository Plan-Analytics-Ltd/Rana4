-- Fix: relationship_type was created as TEXT; Prisma expects RelationshipType enum.
ALTER TABLE "deliverable_activity_relationships"
  ALTER COLUMN "relationship_type" TYPE "RelationshipType"
  USING ("relationship_type"::"RelationshipType");
