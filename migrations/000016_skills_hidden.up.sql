-- Add is_hidden flag to skills for soft-hiding without data loss.
-- Hidden skills don't appear in the picker but historical member_skills remain intact.
ALTER TABLE skills ADD COLUMN is_hidden BOOLEAN NOT NULL DEFAULT false;
