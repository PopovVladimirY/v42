-- Give teams a role in the org hierarchy.
-- admin_team: gets auto-added to every project, full access.
-- management_team: gets auto-added to every project, read-only observers.
CREATE TYPE team_category AS ENUM ('normal', 'admin_team', 'management_team');
ALTER TABLE teams ADD COLUMN category team_category NOT NULL DEFAULT 'normal';
