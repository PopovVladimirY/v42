-- Add 'agent' value to user_role enum.
-- Agents have full CRUD on backlog/tasks/tests but cannot be admin or maintainer.
-- ALTER TYPE ADD VALUE cannot run inside a transaction (postgres limitation).
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'agent';
