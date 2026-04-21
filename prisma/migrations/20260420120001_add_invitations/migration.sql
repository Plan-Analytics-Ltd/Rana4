-- Add invitations table for multi-user companies.

CREATE TABLE IF NOT EXISTS "invitations" (
  "id" TEXT NOT NULL,
  "email" VARCHAR(255) NOT NULL,
  "company_id" TEXT NOT NULL,
  "role" "Role" NOT NULL,
  "token" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "invitations_token_key" ON "invitations"("token");
CREATE INDEX IF NOT EXISTS "invitations_company_id_idx" ON "invitations"("company_id");
CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "invitations"("email");

