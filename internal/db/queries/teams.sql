-- name: ListTeams :many
SELECT id, name, description, is_archived, created_at, updated_at
FROM teams
WHERE is_archived = false
ORDER BY name;

-- name: CreateTeam :one
-- Admin/maintainer only.
INSERT INTO teams (name, description)
VALUES ($1, $2)
RETURNING id, name, description, is_archived, created_at, updated_at;

-- name: GetTeamByID :one
SELECT id, name, description, is_archived, created_at, updated_at
FROM teams
WHERE id = $1;

-- name: UpdateTeam :one
UPDATE teams
SET
    name        = $2,
    description = $3,
    updated_at  = now()
WHERE id = $1
RETURNING id, name, description, is_archived, created_at, updated_at;

-- name: ArchiveTeam :one
-- Admin only. Sets is_archived = true instead of deleting.
UPDATE teams SET is_archived = true, updated_at = now()
WHERE id = $1
RETURNING id, name, description, is_archived, created_at, updated_at;

-- name: DeleteTeam :exec
-- Admin only. FK cascade removes team_members.
DELETE FROM teams WHERE id = $1;

-- name: ListTeamMembers :many
-- Returns team members joined with user data.
SELECT
    tm.team_id,
    tm.user_id,
    tm.capacity_hours,
    tm.joined_at,
    u.email,
    u.display_name,
    u.role,
    u.is_active,
    u.avatar_url
FROM team_members tm
JOIN users u ON u.id = tm.user_id
WHERE tm.team_id = $1
ORDER BY u.display_name;

-- name: AddTeamMember :one
-- Upsert: re-adding is a no-op that updates capacity_hours.
INSERT INTO team_members (team_id, user_id, capacity_hours)
VALUES ($1, $2, $3)
ON CONFLICT (team_id, user_id) DO UPDATE
    SET capacity_hours = EXCLUDED.capacity_hours
RETURNING team_id, user_id, capacity_hours, joined_at;

-- name: RemoveTeamMember :exec
DELETE FROM team_members
WHERE team_id = $1 AND user_id = $2;
