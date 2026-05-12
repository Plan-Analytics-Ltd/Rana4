CREATE SCHEMA IF NOT EXISTS private_data;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS private_data.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT,
  request_id TEXT,
  trace_id TEXT,
  session_id TEXT,
  action TEXT NOT NULL,
  resource_category TEXT NOT NULL,
  resource_id TEXT,
  company_id TEXT,
  resource_type TEXT,
  decrypt_count INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  query_duration_ms INTEGER NOT NULL DEFAULT 0,
  access_granted BOOLEAN NOT NULL DEFAULT false,
  hash TEXT,
  previous_hash TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS audit_log_company_created_idx
  ON private_data.audit_log(company_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_user_created_idx
  ON private_data.audit_log(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_request_id_idx
  ON private_data.audit_log(request_id);

CREATE INDEX IF NOT EXISTS audit_log_action_created_idx
  ON private_data.audit_log(action, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_log_resource_created_idx
  ON private_data.audit_log(resource_category, resource_type, created_at DESC);

CREATE OR REPLACE FUNCTION private_data.reject_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'private_data.audit_log is append-only';
END;
$$;

DROP TRIGGER IF EXISTS audit_log_reject_update ON private_data.audit_log;
CREATE TRIGGER audit_log_reject_update
  BEFORE UPDATE ON private_data.audit_log
  FOR EACH ROW EXECUTE FUNCTION private_data.reject_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_reject_delete ON private_data.audit_log;
CREATE TRIGGER audit_log_reject_delete
  BEFORE DELETE ON private_data.audit_log
  FOR EACH ROW EXECUTE FUNCTION private_data.reject_audit_log_mutation();

DROP TRIGGER IF EXISTS audit_log_reject_truncate ON private_data.audit_log;
CREATE TRIGGER audit_log_reject_truncate
  BEFORE TRUNCATE ON private_data.audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION private_data.reject_audit_log_mutation();

REVOKE UPDATE, DELETE, TRUNCATE ON private_data.audit_log FROM PUBLIC;
