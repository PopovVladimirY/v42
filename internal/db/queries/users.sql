-- name: GetUserByEmail :one
-- Login: fetches full row including password_hash for bcrypt verification.
SELECT id, email, password_hash, display_name, role, is_active, avatar_url, created_at, updated_at
FROM users
WHERE email = $1;

-- name: GetUserByID :one
-- JWT middleware + /auth/me: no password_hash returned.
SELECT id, email, display_name, role, is_active, avatar_url, created_at, updated_at
FROM users
WHERE id = $1;

-- name: CreateUser :one
INSERT INTO users (email, password_hash, display_name, role)
VALUES ($1, $2, $3, $4)
RETURNING id, email, display_name, role, is_active, avatar_url, created_at, updated_at;
