-- Admin request workflow cleanup
-- - Remove verification-code fields (code, expires_at) and associated index
-- - Normalize legacy statuses: USED -> APPROVED

UPDATE "admin_requests"
SET "status" = 'APPROVED'
WHERE "status" = 'USED';

-- Drop legacy index/columns if present (older installs).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND indexname = 'admin_requests_code_key'
  ) THEN
    EXECUTE 'DROP INDEX "admin_requests_code_key"';
  END IF;
END $$;

ALTER TABLE "admin_requests"
  DROP COLUMN IF EXISTS "code",
  DROP COLUMN IF EXISTS "expires_at";

