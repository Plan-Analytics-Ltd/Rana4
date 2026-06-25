-- -----------------------------------------------------------------------------
-- Indexes (foreign keys)
-- -----------------------------------------------------------------------------
-- Improves join and cascade performance. Naming: idx_<table>_<column(s)>.
-- -----------------------------------------------------------------------------

-- assurance_notes
CREATE INDEX idx_assurance_notes_standard_id ON assurance_notes(standard_id);

-- fragnets
CREATE INDEX idx_fragnets_standard_id ON fragnets(standard_id);

-- activities
CREATE INDEX idx_activities_fragnet_id ON activities(fragnet_id);
CREATE INDEX idx_activities_assurance_note_id ON activities(assurance_note_id);

-- relationships
CREATE INDEX idx_relationships_fragnet_id ON relationships(fragnet_id);
CREATE INDEX idx_relationships_predecessor_activity_id ON relationships(predecessor_activity_id);
CREATE INDEX idx_relationships_successor_activity_id ON relationships(successor_activity_id);

-- deliverables
CREATE INDEX idx_deliverables_standard_id ON deliverables(standard_id);
CREATE INDEX idx_deliverables_assurance_note_id ON deliverables(assurance_note_id);
