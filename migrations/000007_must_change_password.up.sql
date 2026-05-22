-- New users created by admin must change their password on first login.
-- Admin resets also flip this flag back to true.
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
