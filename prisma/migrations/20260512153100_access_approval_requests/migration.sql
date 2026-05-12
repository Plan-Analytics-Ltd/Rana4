CREATE SCHEMA IF NOT EXISTS private_data;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS private_data.access_approval_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  request_id TEXT,
  trace_id TEXT,
  session_id TEXT,

  requesting_user_id TEXT NOT NULL,
  approver_user_id TEXT,

  resource_category TEXT NOT NULL,
  resource_id TEXT,
  company_id TEXT NOT NULL,
  resource_type TEXT,

  requested_action TEXT NOT NULL,

  status TEXT NOT NULL,
  reason TEXT,

  expires_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  denied_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,

  approval_token_hash TEXT,
  usage_count INTEGER NOT NULL DEFAULT 0,
  max_decrypt_count INTEGER NOT NULL DEFAULT 25,
  max_batch_size INTEGER NOT NULL DEFAULT 50,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT access_approval_requests_status_chk
    CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'revoked')),
  CONSTRAINT access_approval_requests_usage_chk
    CHECK (usage_count >= 0 AND max_decrypt_count >= 0 AND max_batch_size >= 0)
);

CREATE INDEX IF NOT EXISTS access_approval_requests_company_status_created_idx
  ON private_data.access_approval_requests(company_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS access_approval_requests_requesting_user_idx
  ON private_data.access_approval_requests(requesting_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS access_approval_requests_scope_idx
  ON private_data.access_approval_requests(company_id, requesting_user_id, resource_category, requested_action, resource_type);

CREATE UNIQUE INDEX IF NOT EXISTS access_approval_requests_token_hash_key
  ON private_data.access_approval_requests(approval_token_hash)
  WHERE approval_token_hash IS NOT NULL;

CREATE OR REPLACE FUNCTION private_data.touch_access_approval_requests_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS access_approval_requests_touch_updated_at ON private_data.access_approval_requests;
CREATE TRIGGER access_approval_requests_touch_updated_at
  BEFORE UPDATE ON private_data.access_approval_requests
  FOR EACH ROW EXECUTE FUNCTION private_data.touch_access_approval_requests_updated_at();
