CREATE SCHEMA IF NOT EXISTS private_data;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS private_data.rate_card_secure (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  resource_type TEXT,
  created_at TIMESTAMP DEFAULT now(),
  payload_enc BYTEA NOT NULL
);

CREATE TABLE IF NOT EXISTS private_data.resource_registry_secure (
  id TEXT PRIMARY KEY,
  company_id TEXT,
  resource_type TEXT,
  created_at TIMESTAMP DEFAULT now(),
  payload_enc BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_card_secure_company_id_idx
  ON private_data.rate_card_secure(company_id);

CREATE INDEX IF NOT EXISTS rate_card_secure_resource_type_idx
  ON private_data.rate_card_secure(resource_type);

CREATE INDEX IF NOT EXISTS resource_registry_secure_company_id_idx
  ON private_data.resource_registry_secure(company_id);

CREATE INDEX IF NOT EXISTS resource_registry_secure_resource_type_idx
  ON private_data.resource_registry_secure(resource_type);
