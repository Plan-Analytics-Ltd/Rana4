-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
-- Required for gen_random_uuid() used by all primary keys.
-- Run this first; requires superuser or database owner.
-- -----------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
