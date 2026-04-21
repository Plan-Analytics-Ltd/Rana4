-- Add audit logs table.

CREATE TABLE IF NOT EXISTS "audit_logs" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "action" VARCHAR(255) NOT NULL,
  "entity" VARCHAR(255) NOT NULL,
  "entity_id" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "audit_logs_company_id_created_at_idx" ON "audit_logs"("company_id", "created_at");
CREATE INDEX IF NOT EXISTS "audit_logs_user_id_created_at_idx" ON "audit_logs"("user_id", "created_at");

