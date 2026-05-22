-- Phase 9: add 'new-york' theme.
-- Drop the old CHECK constraint, re-add with the new value.
-- PostgreSQL does not support ALTER CONSTRAINT for CHECK, so drop+add it is.

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;

ALTER TABLE users
    ADD CONSTRAINT users_theme_check CHECK (theme IN (
        'deep-dive',
        'night-sky',
        'classic-dark',
        'ocean-blue',
        'paper-white',
        'sunrise',
        'high-contrast',
        'new-york'
    ));
