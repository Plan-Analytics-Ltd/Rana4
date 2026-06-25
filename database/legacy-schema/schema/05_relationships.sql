-- -----------------------------------------------------------------------------
-- relationships
-- -----------------------------------------------------------------------------
-- Predecessor–successor links between activities. Types: FS, SS, FF, SF.
-- Predecessor and successor must be distinct.
-- -----------------------------------------------------------------------------

CREATE TABLE relationships (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fragnet_id              UUID NOT NULL REFERENCES fragnets(id) ON DELETE CASCADE,
    predecessor_activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    successor_activity_id   UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
    relationship_type      VARCHAR(2) NOT NULL CHECK (relationship_type IN ('FS', 'SS', 'FF', 'SF')),
    lag                     INTEGER NOT NULL DEFAULT 0,
    CHECK (predecessor_activity_id <> successor_activity_id)
);
