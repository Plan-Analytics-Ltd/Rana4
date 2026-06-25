-- -----------------------------------------------------------------------------
-- activities
-- -----------------------------------------------------------------------------
-- Activities within a fragnet; identified by activity_code per fragnet.
-- Optional link to an assurance note.
-- -----------------------------------------------------------------------------

CREATE TABLE activities (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    fragnet_id         UUID NOT NULL REFERENCES fragnets(id) ON DELETE CASCADE,
    activity_code      VARCHAR(100) NOT NULL,
    name               VARCHAR(255) NOT NULL,
    best_duration      INTEGER NOT NULL CHECK (best_duration > 0),
    likely_duration    INTEGER NOT NULL CHECK (likely_duration > 0),
    assurance_note_id  UUID REFERENCES assurance_notes(id) ON DELETE SET NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT now(),
    UNIQUE (fragnet_id, activity_code)
);
