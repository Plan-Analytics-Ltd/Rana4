-- -----------------------------------------------------------------------------
-- standards
-- -----------------------------------------------------------------------------
-- Root entity for scheduling standards. Fragnets, assurance notes, and
-- deliverables are scoped to a standard.
-- -----------------------------------------------------------------------------

CREATE TABLE standards (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);
