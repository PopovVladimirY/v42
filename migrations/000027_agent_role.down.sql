-- Cannot remove enum values in PostgreSQL without recreating the type.
-- To decommission the 'agent' role: migrate all agent users to 'observer' first.
-- UPDATE users SET role = 'observer' WHERE role = 'agent';
-- Then recreate the enum without 'agent' (requires table recreation -- not automated here).
SELECT 1; -- no-op placeholder
