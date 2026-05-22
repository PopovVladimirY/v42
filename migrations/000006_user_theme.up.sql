-- Phase 8: user theme preference.
-- Stored server-side so the theme follows the user across browsers/devices.
-- Validated via CHECK -- unknown theme strings are rejected at the DB level.

ALTER TABLE users
    ADD COLUMN theme TEXT NOT NULL DEFAULT 'deep-dive'
        CHECK (theme IN (
            'deep-dive',
            'night-sky',
            'classic-dark',
            'ocean-blue',
            'paper-white',
            'sunrise',
            'high-contrast'
        ));
