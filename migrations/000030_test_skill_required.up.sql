-- Add an optional required-skill FK to test specs, mirroring tasks.skill_required.
-- Lets a test declare which skill is needed to execute it (e.g. QA Automation).
ALTER TABLE tests
    ADD COLUMN skill_required UUID REFERENCES skills(id) ON DELETE SET NULL;
