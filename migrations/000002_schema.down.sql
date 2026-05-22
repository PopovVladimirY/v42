-- Drop in reverse creation order (respect FK dependencies).

DROP TABLE IF EXISTS outbox;
DROP TABLE IF EXISTS activity_log;
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS sprint_test_results;
DROP TABLE IF EXISTS time_entries;
DROP TABLE IF EXISTS test_dependencies;
DROP TABLE IF EXISTS tests;
DROP TABLE IF EXISTS sprint_items;
DROP TABLE IF EXISTS sprints;
DROP TABLE IF EXISTS tasks;
DROP TABLE IF EXISTS backlog_items;
DROP TABLE IF EXISTS stages;
DROP TABLE IF EXISTS releases;
DROP TABLE IF EXISTS epics;
DROP TABLE IF EXISTS projects;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS member_skills;
DROP TABLE IF EXISTS team_members;
DROP TABLE IF EXISTS teams;
DROP TABLE IF EXISTS skills;
DROP TABLE IF EXISTS users;

DROP TYPE IF EXISTS test_run_status;
DROP TYPE IF EXISTS test_type;
DROP TYPE IF EXISTS sprint_status;
DROP TYPE IF EXISTS task_status;
DROP TYPE IF EXISTS item_status;
DROP TYPE IF EXISTS item_type;
DROP TYPE IF EXISTS stage_status;
DROP TYPE IF EXISTS release_status;
DROP TYPE IF EXISTS epic_status;
DROP TYPE IF EXISTS project_status;
DROP TYPE IF EXISTS interest_level;
DROP TYPE IF EXISTS skill_level;
DROP TYPE IF EXISTS user_role;
