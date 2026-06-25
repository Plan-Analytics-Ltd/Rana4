-- -----------------------------------------------------------------------------
-- Apply full scheduling schema
-- -----------------------------------------------------------------------------
-- Run from project root:  psql -U <user> -d <database> -f database/legacy-schema/apply_schema.sql
-- Or from database/legacy-schema/:  psql -U <user> -d <database> -f apply_schema.sql
-- Uses \ir so paths are relative to this file's directory.
-- -----------------------------------------------------------------------------

\ir schema/00_extensions.sql
\ir schema/01_standards.sql
\ir schema/02_assurance_notes.sql
\ir schema/03_fragnets.sql
\ir schema/04_activities.sql
\ir schema/05_relationships.sql
\ir schema/06_deliverables.sql
\ir schema/07_indexes.sql
