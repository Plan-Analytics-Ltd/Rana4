-- -----------------------------------------------------------------------------
-- deliverables
-- -----------------------------------------------------------------------------
-- Deliverables under a standard with duration estimates; optional assurance note.
-- -----------------------------------------------------------------------------

CREATE TABLE deliverables (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id        UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    name               VARCHAR(255) NOT NULL,
    best_duration      INTEGER NOT NULL CHECK (best_duration > 0),
    likely_duration    INTEGER NOT NULL CHECK (likely_duration > 0),
    assurance_note_id  UUID REFERENCES assurance_notes(id) ON DELETE SET NULL,
    created_at         TIMESTAMP NOT NULL DEFAULT now()
);
