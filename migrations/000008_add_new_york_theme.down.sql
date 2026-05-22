-- Revert: drop 'new-york' from the theme CHECK constraint.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_theme_check;

ALTER TABLE users
    ADD CONSTRAINT users_theme_check CHECK (theme IN (
        'deep-dive',
        'night-sky',
        'classic-dark',
        'ocean-blue',
        'paper-white',
        'sunrise',
        'high-contrast'
    ));
