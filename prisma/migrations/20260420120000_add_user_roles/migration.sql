-- Add Role enum and role column on users.

DO $$ BEGIN
  CREATE TYPE "Role" AS ENUM ('ADMIN', 'MEMBER');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "role" "Role" NOT NULL DEFAULT 'ADMIN';

