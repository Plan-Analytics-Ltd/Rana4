-- -----------------------------------------------------------------------------
-- assurance_notes
-- -----------------------------------------------------------------------------
-- Notes attached to a standard; can be linked from activities or deliverables.
-- -----------------------------------------------------------------------------

CREATE TABLE assurance_notes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    standard_id UUID NOT NULL REFERENCES standards(id) ON DELETE CASCADE,
    note_text   TEXT NOT NULL,
    created_at  TIMESTAMP NOT NULL DEFAULT now()
);
