-- Drop the required-skill column from test specs.
ALTER TABLE tests
    DROP COLUMN IF EXISTS skill_required;
