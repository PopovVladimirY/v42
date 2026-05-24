-- name: SetNodeSkillRequirement :one
-- Upsert: insert or update skill requirement for a node.
INSERT INTO node_skill_requirements (node_id, skill_id, min_level, headcount, notes)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (node_id, skill_id) DO UPDATE
  SET min_level = EXCLUDED.min_level,
      headcount = EXCLUDED.headcount,
      notes     = EXCLUDED.notes
RETURNING node_id, skill_id, min_level, headcount, notes;

-- name: GetNodeSkillRequirements :many
SELECT nsr.node_id, nsr.skill_id, nsr.min_level, nsr.headcount, nsr.notes,
       s.name AS skill_name, s.category AS skill_category
FROM   node_skill_requirements nsr
JOIN   skills s ON s.id = nsr.skill_id
WHERE  nsr.node_id = $1
ORDER  BY s.name;

-- name: DeleteNodeSkillRequirement :exec
DELETE FROM node_skill_requirements WHERE node_id = $1 AND skill_id = $2;

-- name: DeleteAllNodeSkillRequirements :exec
DELETE FROM node_skill_requirements WHERE node_id = $1;
