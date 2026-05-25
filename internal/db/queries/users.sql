-- name: GetUserByEmail :one
-- Login: fetches full row including password_hash for bcrypt verification.
SELECT id, email, password_hash, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
-- JWT middleware + /auth/me: no password_hash returned.
SELECT id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, ui_settings, last_active_at, created_at, updated_at
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name, role, must_change_password)
VALUES ($1, $2, $3, $4, $5)
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at;

-- name: ListAllUsers :many
-- Admin/maintainer: returns all users regardless of active status.
SELECT id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at
FROM users
ORDER BY display_name, email;

-- name: ListActiveUsers :many
-- Regular users: see only active accounts.
SELECT id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at
FROM users
WHERE is_active = true
ORDER BY display_name, email;

-- name: UpdateUser :one
-- PATCH /users/{id}: caller merges current state with request, then calls this.
UPDATE users
SET
    display_name = $2,
    avatar_url   = $3,
    role         = $4,
    is_active    = $5,
    email        = $6,
    updated_at   = now()
WHERE id = $1
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at;

-- name: UpdateUserTheme :one
-- PATCH /auth/me: user sets their own theme preference.
UPDATE users
SET
    theme      = $2,
    updated_at = now()
WHERE id = $1
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, ui_settings, last_active_at, created_at, updated_at;

-- name: UpdateUserSettings :one
-- PATCH /auth/me: user saves UI preferences (merge is done in handler).
UPDATE users
SET
    ui_settings = $2,
    updated_at  = now()
WHERE id = $1
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, ui_settings, last_active_at, created_at, updated_at;

-- name: UpdateUserLastActive :exec
-- Auth middleware: throttled heartbeat. Only writes if stale (>1 min since last update).
UPDATE users
SET last_active_at = now()
WHERE id = $1
  AND (last_active_at IS NULL OR last_active_at < now() - INTERVAL '1 minute');

-- name: UpdateUserIdleTimeout :one
-- PATCH /auth/me: user sets their idle timeout preference.
UPDATE users
SET
    idle_timeout_minutes = $2,
    updated_at           = now()
WHERE id = $1
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, ui_settings, last_active_at, created_at, updated_at;

-- name: UpdateUserPassword :one
-- POST /auth/change-password and admin PATCH /users/{id}/reset-password.
-- must_change_password is set to false when user self-changes, true when admin resets.
UPDATE users
SET
    password_hash        = $2,
    must_change_password = $3,
    updated_at           = now()
WHERE id = $1
RETURNING id, email, display_name, role, is_active, must_change_password, avatar_url, theme, idle_timeout_minutes, created_at, updated_at;

