-- Rollback: remove builtin skills (only those not referenced by member_skills).
-- In production this would cascade or fail -- acceptable for rollback scenario.
DELETE FROM skills WHERE is_builtin = true;
