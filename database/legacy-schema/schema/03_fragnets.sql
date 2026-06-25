-- -----------------------------------------------------------------------------
-- fragnets
-- -----------------------------------------------------------------------------
-- Fragment networks under a standard; contain activities and relationships.
-- -----------------------------------------------------------------------------

CREATE TABLE fragnets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);
