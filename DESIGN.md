# V.42 -- Design Document

> "Закладываем краеугольный камень. Всё что здесь -- живёт. Всё что не здесь -- ждёт своей очереди."

---

## Стек (финальный, без пересмотра)

| Слой        | Технология                              | Почему                                      |
|-------------|------------------------------------------|---------------------------------------------|
| Backend     | Go 1.25                                 | Стабильность, один бинарник, нет node_modules |
| Router      | [chi v5](DETAILS.md#chi----http-роутер) | Минималистичный, idiomatic, без магии        |
| SQL         | [sqlc](DETAILS.md#sqlc----типизированный-sql-без-orm) + [golang-migrate](DETAILS.md#golang-migrate----миграции-схемы) | Типизированный SQL без ORM |
| Database    | [PostgreSQL 16](DETAILS.md#postgresql----база-данных) | Стандарт, надёжность, JSONB когда надо |
| Auth        | [JWT](DETAILS.md#jwt----авторизация-без-состояния) (golang-jwt/jwt/v5) | Прозрачно, без фреймворк-магии |
| Frontend    | React 18 + TypeScript + Vite            | Лучший экосистем для board UI                |
| Drag&Drop   | dnd-kit                                 | Зрелый, a11y, гибкий                         |
| Real-time   | [SSE](DETAILS.md#sse----server-sent-events-real-time) (Server-Sent Events) | Проще WebSocket, встроено в Go |
| Deployment  | [Docker Compose](DETAILS.md#docker-compose----запускаем-всё-вместе) | `docker compose up` -- и всё работает |

> Подробное объяснение каждого инструмента: зачем, как работает, почему именно он -- в [DETAILS.md](DETAILS.md).

---

## Структура проекта

```
v42/
  cmd/
    api/
      main.go              -- точка входа, wire-up всего
  internal/
    api/
      handler_auth.go      -- login, refresh, logout, me, change-password
      handler_backlog.go   -- backlog items + reorder
      handler_comments_capacity.go  -- comments + capacity analytics (skill-radar etc.)
      handler_epics.go     -- CRUD epics
      handler_projects.go  -- CRUD projects + archive/tree/hierarchy + project-teams
      handler_skills.go    -- CRUD skills catalog + hidden toggle
      handler_tasks_sprints.go     -- tasks + time-logging + sprints + sprint test-results
      handler_teams.go     -- CRUD teams + members + archive/category
      handler_tests.go     -- CRUD tests at project/epic/backlog-item level
      handler_test_results.go      -- sprint test result update
      handler_users.go     -- CRUD users + reset-password + user skills
      middleware/
        auth.go            -- JWT validation
        roles.go           -- role-based access
        logger.go          -- request logging
        cors.go            -- CORS headers
        ratelimit.go       -- rate limiting (auth endpoints)
      router.go            -- chi router setup, all routes registered here
    domain/                -- pure business logic, no HTTP, no SQL
      project.go
      epic.go
      backlog.go
      sprint.go
      team.go
      skill.go
      capacity.go          -- load planning calculations
      stats.go             -- statistics normalization
      testrun.go           -- test result aggregation logic
    db/
      queries/             -- .sql files (sqlc reads these)
        projects.sql
        project_teams.sql
        epics.sql
        backlog.sql
        tasks.sql
        tests.sql
        sprints.sql
        sprint_test_results.sql
        teams.sql
        users.sql
        skills.sql
        skills_capacity.sql
        comments.sql
        milestones.sql
        time_entries.sql
        refresh_tokens.sql
        node_skill_requirements.sql
      gen/                 -- sqlc-generated Go code (do not edit)
      store/               -- store interface + implementation
      sqlc.yaml            -- sqlc config
      db.go                -- connection setup
    config/
      config.go            -- env vars, validated at startup
    auth/
      jwt.go               -- token generation and validation
      password.go          -- bcrypt helpers
  migrations/              -- golang-migrate SQL files (000001-000019)
    000001_init.{up,down}.sql
    000002_schema.{up,down}.sql
    000003_drop_redundant_token_hash_index.{up,down}.sql
    000004_seed_builtin_skills.{up,down}.sql
    000005_growth_mechanics.{up,down}.sql
    000006_user_theme.{up,down}.sql
    000007_must_change_password.{up,down}.sql
    000008_add_new_york_theme.{up,down}.sql
    000009_user_idle_timeout.{up,down}.sql
    000010_project_teams.{up,down}.sql          -- M:M project<->team
    000011_seq_ids.{up,down}.sql                -- sequential numeric IDs
    000012_epic_clarity.{up,down}.sql           -- clarity_level on epics
    000013_backlog_clarity.{up,down}.sql        -- clarity_level on backlog items
    000014_item_status_expansion.{up,down}.sql  -- expanded status enum
    000015_item_status_migrate_data.{up,down}.sql
    000016_skills_hidden.{up,down}.sql          -- is_hidden flag on skills
    000017_archive_teams_projects.{up,down}.sql -- archive for teams + projects
    000018_project_hierarchy.{up,down}.sql      -- parent/child project nodes
    000019_team_category.{up,down}.sql          -- team category enum
  frontend/                -- React app (built to frontend/dist/)
    src/
      api/                 -- typed API client (axios wrappers)
      components/
      pages/
      store/               -- Zustand global state
    index.html
    vite.config.ts
    tsconfig.json
  docker/
    postgres/
      init.sql             -- initial DB setup (extensions etc.)
  Dockerfile               -- multi-stage: build -> minimal runtime image
  docker-compose.yml
  docker-compose.dev.yml   -- with hot-reload volumes
  Makefile
  .env.example
  go.mod
  go.sum
```

---

## Схема базы данных

> Порядок CREATE TABLE в миграции строго соблюдает зависимости:
> users -> skills -> teams -> team_members -> member_skills -> refresh_tokens
> -> projects -> epics -> releases -> stages
> -> backlog_items -> tasks -> sprints -> sprint_items
> -> tests -> test_dependencies -> time_entries -> sprint_test_results -> comments
> -> activity_log -> outbox

### Ядро: пользователи и права

```sql
-- Roles: system-wide
CREATE TYPE user_role AS ENUM (
    'admin',        -- full access, manages instance
    'maintainer',   -- manages projects, teams
    'developer',    -- works on tasks
    'tester',       -- works on tests
    'observer'      -- read-only (the "curious manager" type)
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    display_name  TEXT NOT NULL,
    role          user_role NOT NULL DEFAULT 'developer',
    is_active     BOOLEAN NOT NULL DEFAULT true,
    avatar_url    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_email ON users(email);
```

### Компетенции и команды

```sql
CREATE TYPE skill_level AS ENUM (
    'beginner',    -- learning, needs guidance
    'competent',   -- can do it independently
    'proficient',  -- does it well, can review others
    'expert'       -- deep knowledge, can mentor
);

CREATE TYPE interest_level AS ENUM ('low', 'medium', 'high');

-- Skill catalog (predefined + custom per instance)
CREATE TABLE skills (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL UNIQUE,  -- e.g., "TypeScript", "Go", "Python"
    category    TEXT,                  -- e.g., "Frontend", "Backend", "QA"
    is_builtin  BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Member skill profile
CREATE TABLE member_skills (
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    skill_id   UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    level      skill_level NOT NULL DEFAULT 'beginner',
    interest   interest_level NOT NULL DEFAULT 'medium',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),  -- when did they acquire the skill
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

-- Refresh tokens for JWT rotation and logout revocation
CREATE TABLE refresh_tokens (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hex hash of the raw token, never plaintext
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at TIMESTAMPTZ           -- NULL = active; set on logout or rotation
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens(token_hash);

CREATE TABLE teams (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE team_members (
    team_id          UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- weekly capacity in hours (accounts for meetings, etc.)
    capacity_hours   SMALLINT NOT NULL DEFAULT 32,
    joined_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (team_id, user_id)
);
```

### Рабочие элементы

```sql
CREATE TYPE project_status AS ENUM ('active', 'on_hold', 'archived');
CREATE TYPE epic_status    AS ENUM ('draft', 'active', 'done', 'cancelled');
CREATE TYPE item_type      AS ENUM ('story', 'bug', 'feature', 'technical_debt');
-- 'done' is not a feeling. It means the acceptance test passed in the sprint.
CREATE TYPE item_status    AS ENUM ('backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled');
CREATE TYPE task_status    AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
-- test_status removed: tests have no global status. Results are tracked per-sprint
-- in sprint_test_results. A test is only meaningful in the context of a sprint run.
CREATE TYPE test_type      AS ENUM ('manual', 'acceptance', 'integration', 'unit');

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    status      project_status NOT NULL DEFAULT 'active',
    -- team_id removed: projects are not owned by a single team.
    -- Teams are linked via project_teams junction table (M:M).
    -- A QA team, a DevOps team, and a Dev team can all work on the same project.
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Project <-> Team: many-to-many.
-- A project can have multiple teams (dev, QA, ops, support).
-- A team can work on multiple projects simultaneously.
-- Visibility rule: user sees project if they are a member of ANY team on the project.
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_project ON project_teams(project_id);
CREATE INDEX idx_project_teams_team    ON project_teams(team_id);

CREATE TABLE epics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      epic_status NOT NULL DEFAULT 'draft',
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- epics are NOT inside releases -- they are an independent dimension
    -- target_date is optional: allows showing epics on timeline
    target_date DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epics_project ON epics(project_id);

-- Releases and stages must be created BEFORE backlog_items (FK dependency).
CREATE TYPE release_status AS ENUM ('planning', 'active', 'released', 'cancelled');
CREATE TYPE stage_status   AS ENUM ('pending', 'active', 'completed', 'cancelled');

CREATE TABLE releases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      release_status NOT NULL DEFAULT 'planning',
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_releases_project ON releases(project_id);

CREATE TABLE stages (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      stage_status NOT NULL DEFAULT 'pending',
    start_date  DATE,
    end_date    DATE,
    order_index FLOAT8 NOT NULL DEFAULT 0,  -- float for drag-and-drop reorder without renumbering
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_release ON stages(release_id);

-- The heart of the system.
-- epic_id, release_id, stage_id are ALL independent nullable foreign keys.
-- A backlog item can belong to any combination: epic only, stage only, both, neither.
--
-- ATDD MODEL: the backlog item IS the acceptance test.
-- description = why this exists (for humans).
-- ac_* fields  = how we prove it exists correctly (for testers and the system).
-- Tasks are the path to a green ac_* run. Status 'done' = acceptance test passed.
CREATE TABLE backlog_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id         UUID REFERENCES epics(id) ON DELETE SET NULL,      -- dimension 1
    release_id      UUID REFERENCES releases(id) ON DELETE SET NULL,   -- dimension 2
    stage_id        UUID REFERENCES stages(id) ON DELETE SET NULL,     -- dimension 3
    title           TEXT NOT NULL,
    description     TEXT,                  -- WHY: context, value, user story
    type            item_type NOT NULL DEFAULT 'story',
    status          item_status NOT NULL DEFAULT 'backlog',
    -- FLOAT8 priority: insert between two items = midpoint, no full renumber needed
    priority        FLOAT8 NOT NULL DEFAULT 0,
    estimate        TEXT,   -- free-form: "3h", "5 points", "L", "half a day" -- no holy wars
    assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required  UUID REFERENCES skills(id) ON DELETE SET NULL,
    -- HOW WE KNOW WE ARE DONE: acceptance criteria = the acceptance test.
    -- These fields are not optional documentation -- they define what 'done' means.
    -- An item without ac_steps is a wish, not a commitment.
    ac_setup        TEXT,  -- preconditions: env, data, user state before the test
    ac_steps        TEXT,  -- step-by-step verification: exactly what to do and click
    ac_expected     TEXT,  -- expected outcome: what the world looks like when it passes
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backlog_project   ON backlog_items(project_id);
CREATE INDEX idx_backlog_epic      ON backlog_items(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_backlog_release   ON backlog_items(release_id) WHERE release_id IS NOT NULL;
CREATE INDEX idx_backlog_stage     ON backlog_items(stage_id) WHERE stage_id IS NOT NULL;
CREATE INDEX idx_backlog_status    ON backlog_items(project_id, status);
CREATE INDEX idx_backlog_priority  ON backlog_items(project_id, priority);

CREATE TABLE tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id  UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT,
    status           task_status NOT NULL DEFAULT 'todo',
    estimate        TEXT,   -- free-form, same convention as backlog_item.estimate
    -- actual_hours removed: computed from SUM(time_entries.hours) to avoid dual source of truth
    order_index      FLOAT8 NOT NULL DEFAULT 0,  -- ordering within backlog item
    assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required   UUID REFERENCES skills(id) ON DELETE SET NULL,
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_backlog_item ON tasks(backlog_item_id);
CREATE INDEX idx_tasks_assignee     ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- Sprints: time-boxed iterations (Scrum)
CREATE TYPE sprint_status AS ENUM ('planning', 'active', 'completed', 'cancelled');

CREATE TABLE sprints (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id        UUID REFERENCES teams(id) ON DELETE SET NULL,
    name           TEXT NOT NULL,  -- e.g., "Sprint 1", "2026-Q2-S3"
    goal           TEXT,           -- what this sprint aims to achieve
    status         sprint_status NOT NULL DEFAULT 'planning',
    start_date     DATE,
    end_date       DATE,
    capacity_hours SMALLINT,       -- total planned team hours for this sprint
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sprints_project ON sprints(project_id);

-- Which backlog items are committed to a sprint
CREATE TABLE sprint_items (
    sprint_id       UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (sprint_id, backlog_item_id)
);

-- Tests: defined once, run many times (once per sprint)
-- Live at multiple levels: backlog_item, epic, or project-level
CREATE TABLE tests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id) ON DELETE CASCADE,  -- acceptance tests
    epic_id          UUID REFERENCES epics(id) ON DELETE CASCADE,          -- epic-level tests
    -- if both are null: project-level / regression test
    title            TEXT NOT NULL,
    description      TEXT,
    -- Structured test definition
    setup            TEXT,            -- preconditions: environment, data, user state
    config           TEXT,            -- configuration parameters used during the test
    steps            TEXT,            -- numbered step-by-step execution instructions
    expected_results TEXT,            -- what should happen if the test passes
    type             test_type NOT NULL DEFAULT 'manual',
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tests_backlog_item ON tests(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_tests_epic         ON tests(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tests_project      ON tests(project_id);

-- Test dependencies: if depends_on fails, test is auto-skipped
CREATE TABLE test_dependencies (
    test_id       UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    depends_on_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
    PRIMARY KEY (test_id, depends_on_id),
    CONSTRAINT no_self_dependency CHECK (test_id != depends_on_id)
);
```

### Таймлайн

```sql
-- Releases and stages are defined earlier in the schema (before backlog_items).
-- Repeated here for readability.

-- Releases are the temporal dimension: WHEN we ship something.
-- They are NOT a container for epics -- they co-exist independently.
CREATE TABLE releases (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      release_status NOT NULL DEFAULT 'planning',
    start_date  DATE,
    end_date    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_releases_project ON releases(project_id);

CREATE TABLE stages (
    -- see definition above in Рабочие элементы section
);
```

### Время и статистика

```sql
-- Time tracking: actual hours logged against tasks
CREATE TABLE time_entries (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    hours       NUMERIC(5,1) NOT NULL CHECK (hours > 0),
    logged_date DATE NOT NULL DEFAULT CURRENT_DATE,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_entries_task   ON time_entries(task_id);
CREATE INDEX idx_time_entries_user   ON time_entries(user_id);
CREATE INDEX idx_time_entries_date   ON time_entries(logged_date);
-- time_entries are immutable (audit trail). No updated_at by design.
-- To correct an error: add a negative entry + new correct entry.
```

### Результаты тестирования по спринтам

```sql
CREATE TYPE test_run_status AS ENUM (
    'pass',
    'failed',
    'skipped',   -- auto-skipped: a dependency test failed, no point running this one
    'disabled',  -- manually excluded from this sprint run
    'on_hold'    -- functionality not implemented yet, test cannot run
);

-- One result row per subject per sprint.
-- Subject is either a regression test OR a backlog item's acceptance criteria.
-- Exactly one of (test_id, backlog_item_id) must be set -- same pattern as comments.
CREATE TABLE sprint_test_results (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sprint_id       UUID NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
    -- exactly one of these:
    test_id         UUID REFERENCES tests(id) ON DELETE CASCADE,          -- regression/integration test
    backlog_item_id UUID REFERENCES backlog_items(id) ON DELETE CASCADE,  -- acceptance criteria run
    status          test_run_status NOT NULL DEFAULT 'skipped',
    -- why skipped: "depends on test X which failed", "environment not ready", etc.
    skip_reason TEXT,
    notes       TEXT,            -- tester observations, actual vs expected delta
    executed_by UUID REFERENCES users(id) ON DELETE SET NULL,
    executed_at TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- one result per subject per sprint
    UNIQUE (sprint_id, test_id),
    UNIQUE (sprint_id, backlog_item_id),
    CONSTRAINT spr_result_exactly_one_subject CHECK (
        (test_id IS NOT NULL)::int + (backlog_item_id IS NOT NULL)::int = 1
    )
);
CREATE INDEX idx_sprint_test_results_sprint  ON sprint_test_results(sprint_id);
CREATE INDEX idx_sprint_test_results_test    ON sprint_test_results(test_id) WHERE test_id IS NOT NULL;
CREATE INDEX idx_sprint_test_results_item    ON sprint_test_results(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_sprint_test_results_status  ON sprint_test_results(sprint_id, status);
```

**Логика auto-skip:**
При старте спринта: создаём строки для всех `test_id` (регрессия) и всех `backlog_item_id`
(приёмочные критерии) со статусом `skipped`.
При выполнении: обновляем статус.
Если тест `failed` -- все тесты у которых он в `test_dependencies` остаются `skipped`
с `skip_reason = 'dependency test {id} failed'`.
Если `backlog_item` завершён со статусом `pass` -- статус item меняется на `done`.
`done` без записи `pass` в `sprint_test_results` -- невозможен (правило в `domain/backlog.go`).
Эта логика в `domain/testrun.go`.

### Комментарии и обсуждения

```sql
-- Comments are available on EVERY planning element.
-- Same nullable-FK pattern as backlog_items: set exactly one parent, rest are null.
-- This keeps queries simple and avoids polymorphic type gymnastics.
CREATE TABLE comments (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- exactly one of these is set (the parent element)
    project_id       UUID REFERENCES projects(id)      ON DELETE CASCADE,
    epic_id          UUID REFERENCES epics(id)          ON DELETE CASCADE,
    release_id       UUID REFERENCES releases(id)       ON DELETE CASCADE,
    stage_id         UUID REFERENCES stages(id)         ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id)  ON DELETE CASCADE,
    task_id          UUID REFERENCES tasks(id)          ON DELETE CASCADE,
    test_id          UUID REFERENCES tests(id)          ON DELETE CASCADE,

    -- body is nullable: set to NULL on soft delete (keeps thread structure intact)
    body        TEXT,
    author_id   UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,

    -- threading: reply to a comment (one level deep -- no rabbit holes)
    parent_id   UUID REFERENCES comments(id) ON DELETE CASCADE,

    -- soft delete: NULL = active, set to now() when deleted (body also nulled)
    deleted_at  TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- exactly one parent must be set -- no orphan comments, no multi-parent comments
    CONSTRAINT comments_exactly_one_parent CHECK (
        (
            (project_id IS NOT NULL)::int +
            (epic_id IS NOT NULL)::int +
            (release_id IS NOT NULL)::int +
            (stage_id IS NOT NULL)::int +
            (backlog_item_id IS NOT NULL)::int +
            (task_id IS NOT NULL)::int +
            (test_id IS NOT NULL)::int
        ) = 1
    )
);
CREATE INDEX idx_comments_project      ON comments(project_id)      WHERE project_id IS NOT NULL;
CREATE INDEX idx_comments_epic         ON comments(epic_id)          WHERE epic_id IS NOT NULL;
CREATE INDEX idx_comments_release      ON comments(release_id)       WHERE release_id IS NOT NULL;
CREATE INDEX idx_comments_stage        ON comments(stage_id)         WHERE stage_id IS NOT NULL;
CREATE INDEX idx_comments_backlog_item ON comments(backlog_item_id)  WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_comments_task         ON comments(task_id)          WHERE task_id IS NOT NULL;
CREATE INDEX idx_comments_test         ON comments(test_id)          WHERE test_id IS NOT NULL;
CREATE INDEX idx_comments_parent       ON comments(parent_id)        WHERE parent_id IS NOT NULL;
```

**Правила для комментариев:**
- Удаление -- только soft delete (`deleted_at = now()`). Тред не рассыпается.
- Редактирование -- только автором, в течение 24 часов (бизнес-правило в domain layer).
- Threading -- один уровень вглубь (ответ на комментарий). Ответы на ответы -- нет.
  Это не Реддит, это рабочий инструмент.
- Observer может читать, но не писать (role check в middleware).

---

## Концепция Целей (Goals Layer)

### Два измерения: Важное vs Необходимое

В планировании регулярно путают две разные вещи:

- **Важное** (importance): *почему* мы вообще это делаем? Запрос клиента, видение продукта,
  бизнес-ценность. Определяется голосованием команды или декларируется внешним источником
  (конкретный клиент, стейкхолдер, market research).

- **Необходимое** (necessity): *что логически вытекает* из важного? Что нужно, чтобы Цель
  стала достижимой? Устанавливается логически, не голосованием. Эпик разбивается на беклог
  в контексте Цели.

Зависимости между беклог-айтемами -- не инструмент для этого. Зависимости хрупкие, плохо
масштабируются и создают иллюзию детерминированности там, где её нет. Цель как смысловой
якорь работает лучше.

### Цель -- это не Эпик

| Эпик                               | Цель                                        |
|------------------------------------|---------------------------------------------|
| "Что и как"                        | "Почему"                                    |
| Группирует беклог тематически      | Группирует беклог по смыслу результата      |
| Технический / функциональный контейнер | Запрос, ожидание, ценность              |
| Один эпик -> много айтемов         | Одна цель -> много путей достижения         |
| Не имеет источника                 | Имеет источник (клиент, команда, рынок)     |
| Достигается через закрытые задачи  | Достигается через ценность для стейкхолдера |

Один и тот же беклог-айтем может быть необходим для нескольких целей одновременно.
Одна цель может достигаться через разные эпики.

### Авто-приоритизация

Когда Цели расставлены по важности, а беклог связан с Целями через `necessity_score`:

```
item_auto_priority = SUM(goal.importance * goal_item.necessity) / SUM(goal.importance)
```

То, что наиболее необходимо для наиболее важных Целей, всплывает само.
Это не блокировка -- это подсказка. Приоритет всегда можно переопределить вручную
(поле `priority FLOAT8` остаётся; auto-priority -- отдельный вычисляемый взгляд).

### Матрица приоритизации (2x2)

```
           HIGH necessity
                |
   [Discuss]    |   [DO FIRST]
   (low imp,    |   (high imp,
    high nec)   |    high nec)
                |
LOW importance--+--HIGH importance
                |
   [Parking     |   [Schedule]
    lot]        |   (high imp,
   (low imp,    |    low nec)
    low nec)    |
                |
           LOW necessity
```

Матрица не назначает работу -- она делает видимой расстановку сил.
Квадрант "Discuss": айтем считается необходимым, но цель малозначима -- стоит пересмотреть.

### Авто-балансировка спринта

Задача: максимизировать покрытие важных Целей при ограниченной ёмкости спринта.

```
maximize:   SUM(goal_coverage_delta * goal.importance)
subject to: SUM(item.estimate) <= sprint_capacity
```

Это задача взвешенного рюкзака (weighted knapsack). V42 решает жадным алгоритмом:
сортировка по `(item_auto_priority / item.estimate)` -> берём по убыванию до исчерпания
capacity. Результат -- рекомендация, не приказ. PM/тимлид решает финально.

Эндпоинт: `GET /projects/{id}/goals/sprint-recommendation?sprint_id={sid}`.
Возвращает: ранжированный список айтемов с обоснованием (какие Цели покрывают).

### Измерение прогресса по Целям

Вместо абстрактных "100 поинтов закрыто":

- Goal X: 68% покрытия (закрыто 17 из 25 связанных айтемов)
- Goal Y: 12% покрытия (2 из 18 -- риск к релизу)
- Goal Z: 100% -- **достигнута** в Sprint 7

Это прогресс для людей, а не для метрических дашбордов.

`goal.status` переходит в `achieved` автоматически когда все связанные айтемы
имеют `status = done`. PM может переопределить вручную.

### Голосование за Цели

Команда голосует за важность Цели (1-5 баллов, один голос на пользователя).
`goal.importance` = среднее взвешенное голосов, округлённое до 0-100.
Maintainer/admin может переопределить вручную -- например, если клиент поставил
ультиматум ("это критично для контракта"). Это declarative override.

Голосование -- не демократия голосованием всей жизни. Это инструмент калибровки:
"как команда реально оценивает важность этой цели?" Полезно до grooming.

### Связь с существующими концепциями

```
Goal (WHY)
  |-- linked to --> Epic (WHAT/HOW grouping, optional alignment)
  |-- requires  --> BacklogItem (WHAT specifically, with necessity score)
                        |-- belongs to --> Sprint (WHEN)
                        |-- belongs to --> Release (WHEN shipped)
                        |-- belongs to --> Stage (WHEN in timeline)
```

Цель не заменяет Эпик. Они существуют в разных измерениях.
Sprints.goal (TEXT) -- описание цели спринта в свободной форме -- не путать с
entity Goal. Поле переименовывается в `sprint_goal_description` в миграции 000010.

---

### Схема таблиц Целей

```sql
CREATE TYPE goal_status AS ENUM (
    'draft',      -- ещё не утверждена командой
    'active',     -- активная цель, берётся в планирование
    'achieved',   -- все необходимые айтемы done (или PM закрыл вручную)
    'cancelled'   -- отменена: требования изменились, клиент ушёл, etc.
);

-- Goals: the WHY layer. Not epic (what/how), not sprint (when). The outcome.
CREATE TABLE goals (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    description  TEXT,           -- expected outcome in human terms
    source       TEXT,           -- "Client: Acme Corp" | "Team vote" | "Market research"
    status       goal_status NOT NULL DEFAULT 'draft',
    -- importance 0-100: computed from votes but overrideable by admin/maintainer
    importance   SMALLINT NOT NULL DEFAULT 50 CHECK (importance BETWEEN 0 AND 100),
    target_date  DATE,           -- optional: deadline or target release date
    created_by   UUID NOT NULL REFERENCES users(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_goals_project ON goals(project_id);
CREATE INDEX idx_goals_status  ON goals(project_id, status);

-- Voting: one vote per user per goal. Weight 1 (meh) to 5 (critical).
CREATE TABLE goal_votes (
    goal_id    UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    weight     SMALLINT NOT NULL DEFAULT 3 CHECK (weight BETWEEN 1 AND 5),
    rationale  TEXT,     -- optional: "this is blocking our Q3 deal"
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, user_id)
);
CREATE INDEX idx_goal_votes_goal ON goal_votes(goal_id);

-- Goal <-> BacklogItem: what work is necessary for this goal
-- Many-to-many with a necessity score: 0 = nice-to-have, 100 = blocking
CREATE TABLE goal_items (
    goal_id         UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    backlog_item_id UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    necessity       SMALLINT NOT NULL DEFAULT 50 CHECK (necessity BETWEEN 0 AND 100),
    added_by        UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, backlog_item_id)
);
CREATE INDEX idx_goal_items_goal ON goal_items(goal_id);
CREATE INDEX idx_goal_items_item ON goal_items(backlog_item_id);

-- Goal <-> Epic: thematic alignment (optional, for roadmap view)
-- "This epic contributes to this goal" -- no necessity score needed here
CREATE TABLE goal_epics (
    goal_id    UUID NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    epic_id    UUID NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (goal_id, epic_id)
);
CREATE INDEX idx_goal_epics_goal ON goal_epics(goal_id);
CREATE INDEX idx_goal_epics_epic ON goal_epics(epic_id);
```

**Migration 000010** (вместе с переименованием `sprints.goal`):
```sql
-- Rename sprint goal description to avoid confusion with Goal entity
ALTER TABLE sprints RENAME COLUMN goal TO sprint_goal;

-- Goals tables
CREATE TYPE goal_status AS ENUM (...);
CREATE TABLE goals (...);
CREATE TABLE goal_votes (...);
CREATE TABLE goal_items (...);
CREATE TABLE goal_epics (...);
```

**sqlc queries** (новый файл `db/queries/goals.sql`):
- `CreateGoal`, `GetGoal`, `ListGoals(project_id, status?)`, `UpdateGoal`, `DeleteGoal`
- `UpsertGoalVote(goal_id, user_id, weight, rationale)` -- INSERT ON CONFLICT DO UPDATE
- `DeleteGoalVote(goal_id, user_id)`
- `GetGoalVoteSummary(goal_id)` -- COUNT, AVG(weight), computed importance
- `LinkGoalItem(goal_id, backlog_item_id, necessity, added_by)`
- `UnlinkGoalItem(goal_id, backlog_item_id)`
- `UpdateGoalItemNecessity(goal_id, backlog_item_id, necessity)`
- `ListGoalItems(goal_id)` -- с JOIN backlog_items
- `ListItemGoals(backlog_item_id)` -- цели, к которым привязан айтем
- `ComputeItemAutoPriority(backlog_item_id)` -- формула из концепции выше
- `GetGoalProgress(goal_id)` -- COUNT(done) / COUNT(total) linked items
- `LinkGoalEpic(goal_id, epic_id)`, `UnlinkGoalEpic(goal_id, epic_id)`

---

## Событийная шина

SQL-база -- один из игроков системы, не единственный. Есть разработчики, пользователи,
клиенты, CI/CD, AI-агенты. Все они живут и общаются в реальном времени. Не через SQL.

```
                           [ Event Bus ]
                                |
     ┌──────────┬───────────────┼───────────────┬──────────┐
     v          v               v               v          v
 developer   user/UI         CI/CD          AI agent   V42 API
  (push)   (SSE stream)  (build.passed)  (suggestion)  (handler)
```

**SQL фиксирует результат.** Шина несёт сигнал.

### Граница: что в SQL, что в шине

| В PostgreSQL (текущее состояние, ACID) | В шине (события, fan-out, интеграции) |
|----------------------------------------|---------------------------------------|
| Все entity-таблицы | `v42.events.items` -- status_changed, assigned |
| `comments` (редактируемые, FK) | `v42.events.sprints` -- started, completed |
| `sprint_test_results` (текущий статус) | `v42.events.tests` -- result_recorded |
| `notifications` (is_read, счётчик) | `v42.events.comments` -- created (для @mentions) |
| `activity_log` (consumer пишет сюда) | `v42.audit` -- полная копия, long retention |
| `outbox` (transactional buffer) | `v42.notifications` -- push к конкретному юзеру |

### Паттерн: Transactional Outbox

В одной TX с основной записью пишем в `outbox`.
Горутина-publisher асинхронно читает непосланные строки и льёт в шину.
Гарантия: если TX откатилась -- outbox чистый. Если шина упала -- outbox ждёт.

```
handler:  BEGIN
          UPDATE backlog_items SET status = 'done' WHERE id = $1
          INSERT INTO outbox (topic, key, payload) VALUES (
              'v42.events.items',
              project_id::text,
              '{"type":"status_changed","from":"review","to":"done",...}'
          )
          COMMIT
          -- if COMMIT fails: nothing sent. if bus fails: outbox retries.

publisher goroutine (runs every 200ms):
          SELECT * FROM outbox WHERE published_at IS NULL ORDER BY created_at LIMIT 100
          -> publish to bus
          -> UPDATE outbox SET published_at = now() WHERE id = ...
```

### Таблицы (заложены в Phase 1 миграции)

```sql
-- Activity log: human-readable trail. Written by event bus consumer, not app code.
CREATE TABLE activity_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    actor_id    UUID REFERENCES users(id) ON DELETE SET NULL,  -- NULL = system/AI agent
    entity_type TEXT NOT NULL,   -- 'backlog_item' | 'sprint' | 'test' | 'comment' | ...
    entity_id   UUID NOT NULL,
    action      TEXT NOT NULL,   -- 'status_changed' | 'assigned' | 'commented' | ...
    payload     JSONB,
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- append-only: no updated_at, no soft delete
CREATE INDEX idx_activity_project ON activity_log(project_id, occurred_at DESC);
CREATE INDEX idx_activity_entity  ON activity_log(entity_type, entity_id, occurred_at DESC);

-- Outbox: transactional guarantee for event delivery.
CREATE TABLE outbox (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic        TEXT NOT NULL,
    key          TEXT NOT NULL,         -- partition key (usually project_id)
    payload      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ            -- NULL = pending
);
CREATE INDEX idx_outbox_unpublished ON outbox(created_at) WHERE published_at IS NULL;
```

### SSE без outbox vs с outbox

| | Phase 7 без шины | Phase 7 с шиной |
|-|------------------|-----------------|
| Broadcaster | горутина внутри процесса | consumer каждого инстанса |
| Масштабирование | один инстанс | горизонтально, без sticky sessions |
| AI агенты | нет | подписываются как любой consumer |

### Выбор шины

Kafka vs NATS JetStream -- решение к Phase 7. Инфраструктура (`kv8-kafka`) уже есть.
Outbox-паттерн не зависит от выбора -- меняется только один файл publisher-горутины.

---

## API -- структура эндпоинтов v1

Все эндпоинты под `/api/v1/`. Авторизация -- Bearer JWT в заголовке.
Ответ всегда в формате `{ "data": ..., "meta": ..., "error": ... }`.

```
-- Legend: [*] = implemented  [ ] = planned (Phase N)

HEALTH
  [*] GET    /api/v1/health

AUTH  (rate-limited: burst=10, then 1 req/6s per IP)
  [*] POST   /api/v1/auth/login              -- { email, password } -> { access_token, user } + httpOnly refresh cookie
  [*] POST   /api/v1/auth/refresh            -- refresh cookie -> new access_token + rotated cookie
  [*] POST   /api/v1/auth/logout             -- revoke refresh token (idempotent)
  [*] GET    /api/v1/auth/me                 -- current user profile
  [*] PATCH  /api/v1/auth/me                 -- update own preferences: { theme, idle_timeout_minutes }
  [*] POST   /api/v1/auth/change-password    -- { current_password, new_password }; clears must_change_password

USERS
  [*] GET    /api/v1/users                   -- list users (role-filtered)
  [*] POST   /api/v1/users                   -- create user [admin]; sets must_change_password=true
  [*] GET    /api/v1/users/{id}              -- get user
  [*] PATCH  /api/v1/users/{id}             -- update (self: display_name/avatar_url; admin: all fields)
  [*] PATCH  /api/v1/users/{id}/reset-password  -- [admin] force new password + must_change_password=true
  [*] GET    /api/v1/users/{id}/skills       -- user skill profile (level + interest per skill)
  [*] PUT    /api/v1/users/{id}/skills/{skill_id}   -- upsert skill entry { level, interest, interest_note }
  [*] DELETE /api/v1/users/{id}/skills/{skill_id}

SKILLS
  [*] GET    /api/v1/skills                  -- skill catalog (?all=true admin: includes hidden)
  [*] POST   /api/v1/skills                  -- create custom skill [admin] { name, category }
  [*] PATCH  /api/v1/skills/{id}             -- update skill [admin]
  [*] PATCH  /api/v1/skills/{id}/hidden      -- { hidden: bool } [admin]; built-in skills use this instead of DELETE
  [*] DELETE /api/v1/skills/{id}             -- [admin]; fails 409 on built-in skills

TEAMS
  [*] GET    /api/v1/teams                   -- list teams (non-archived by default)
  [*] GET    /api/v1/teams/mine              -- teams current user belongs to
  [*] POST   /api/v1/teams                   -- create team [admin/maintainer]
  [*] GET    /api/v1/teams/{id}              -- team details + members
  [*] PATCH  /api/v1/teams/{id}             -- update team [admin/maintainer]
  [*] DELETE /api/v1/teams/{id}             -- [admin]
  [*] PATCH  /api/v1/teams/{id}/archive      -- [admin]
  [*] PATCH  /api/v1/teams/{id}/unarchive    -- [admin]
  [*] PATCH  /api/v1/teams/{id}/category     -- { category: normal|admin_team|management_team } [admin]
  [*] POST   /api/v1/teams/{id}/members      -- add member { user_id, capacity_hours } [admin/maintainer]
  [*] DELETE /api/v1/teams/{id}/members/{user_id}  -- [admin/maintainer]

PROJECTS
  [*] GET    /api/v1/projects                -- list (role-filtered; ?team_id= ?status=)
  [*] GET    /api/v1/projects/archived       -- [admin] list archived projects
  [*] POST   /api/v1/projects                -- create project [admin/maintainer]
  [*] GET    /api/v1/projects/{id}           -- project details
  [*] PATCH  /api/v1/projects/{id}          -- update [admin/maintainer]
  [*] DELETE /api/v1/projects/{id}          -- [admin]
  [*] PATCH  /api/v1/projects/{id}/archive   -- [admin]
  [*] PATCH  /api/v1/projects/{id}/unarchive -- [admin]
  [*] GET    /api/v1/projects/{id}/tree      -- hierarchical node tree (?show_archived=true)
  [*] POST   /api/v1/projects/{id}/children  -- create child node { name, description }
  [*] PATCH  /api/v1/projects/{id}/move      -- move in hierarchy { parent_id, order_index }
  [*] GET    /api/v1/projects/{id}/teams     -- teams linked to project
  [*] POST   /api/v1/projects/{id}/teams     -- link team { team_id } [admin/maintainer]
  [*] DELETE /api/v1/projects/{id}/teams/{team_id}  -- unlink team [admin/maintainer]

EPICS
  [*] GET    /api/v1/projects/{id}/epics           -- list epics
  [*] POST   /api/v1/projects/{id}/epics           -- create epic { title, description, status, clarity, target_date }
  [*] GET    /api/v1/projects/{id}/epics/{epic_id} -- epic details
  [*] PATCH  /api/v1/projects/{id}/epics/{epic_id} -- update epic [admin/maintainer]
  [*] DELETE /api/v1/projects/{id}/epics/{epic_id} -- [admin/maintainer]

RELEASES (Phase 5 -- not yet implemented)
  [ ] GET    /api/v1/projects/{id}/releases
  [ ] POST   /api/v1/projects/{id}/releases
  [ ] GET    /api/v1/releases/{id}
  [ ] PATCH  /api/v1/releases/{id}
  [ ] GET    /api/v1/releases/{id}/stages
  [ ] POST   /api/v1/releases/{id}/stages
  [ ] GET    /api/v1/stages/{id}
  [ ] PATCH  /api/v1/stages/{id}

BACKLOG
  [*] GET    /api/v1/projects/{id}/backlog   -- list items
                                             --   ?epic_id= ?status= ?clarity= ?assignee_id=
                                             --   ?page=1 &per_page=50
  [*] POST   /api/v1/projects/{id}/backlog   -- create item (ATDD fields: ac_setup, ac_steps, ac_expected)
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}   -- item details
  [*] PATCH  /api/v1/projects/{id}/backlog/{item_id}   -- partial update (status, epic, priority, clarity...)
  [*] DELETE /api/v1/projects/{id}/backlog/{item_id}
  [*] POST   /api/v1/projects/{id}/backlog/reorder     -- { items: [{id, priority},...] } atomically

TASKS  (nested under backlog items)
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/tasks
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tasks
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}
  [*] PATCH  /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}
  [*] DELETE /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/move   -- { target_item_id }

TIME LOGGING
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/time         -- { hours, logged_date, note }
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/time         -- time entries
  [*] DELETE /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/time/{entry_id}

TESTS  (three scopes: project / epic / backlog item)
  [*] GET    /api/v1/projects/{id}/tests                                 -- all project tests
  [*] POST   /api/v1/projects/{id}/tests                                 -- create test
  [*] GET    /api/v1/projects/{id}/tests/{test_id}
  [*] PATCH  /api/v1/projects/{id}/tests/{test_id}
  [*] DELETE /api/v1/projects/{id}/tests/{test_id}
  [*] GET    /api/v1/projects/{id}/epics/{epic_id}/tests
  [*] POST   /api/v1/projects/{id}/epics/{epic_id}/tests
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/tests
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tests
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tests/{test_id}/move   -- { target_item_id }

SPRINTS
  [*] GET    /api/v1/projects/{id}/sprints                           -- list sprints
  [*] POST   /api/v1/projects/{id}/sprints                          -- create sprint [admin/maintainer]
  [*] GET    /api/v1/projects/{id}/sprints/{sprint_id}
  [*] PATCH  /api/v1/projects/{id}/sprints/{sprint_id}             -- setting status=active seeds test-results
  [*] DELETE /api/v1/projects/{id}/sprints/{sprint_id}             -- [admin/maintainer]
  [*] GET    /api/v1/projects/{id}/sprints/{sprint_id}/items        -- backlog items in sprint
  [*] POST   /api/v1/projects/{id}/sprints/{sprint_id}/items        -- { backlog_item_id }
  [*] DELETE /api/v1/projects/{id}/sprints/{sprint_id}/items/{backlog_item_id}
  [*] POST   /api/v1/projects/{id}/sprints/{sprint_id}/test-results/init  -- seed results (idempotent)
  [*] GET    /api/v1/projects/{id}/sprints/{sprint_id}/test-results
  [*] PATCH  /api/v1/projects/{id}/sprints/{sprint_id}/test-results/{result_id}  -- { status, notes, skip_reason }
  [ ] GET    /api/v1/projects/{id}/sprints/{sprint_id}/board        -- board view (Phase 5)

CAPACITY ANALYTICS
  [*] GET    /api/v1/users/{id}/skill-radar        -- skill profile data for radar chart
  [*] GET    /api/v1/users/{id}/learning-appetite  -- interest signal analysis
  [*] GET    /api/v1/users/{id}/engagement         -- computed engagement score
  [*] GET    /api/v1/teams/{id}/skill-matrix       -- members x skills proficiency matrix
  [*] GET    /api/v1/teams/{id}/tandems            -- mentoring pair candidates
  [*] GET    /api/v1/teams/{id}/learning-appetite  -- team-level interest aggregation
  [*] GET    /api/v1/teams/{id}/skill-coverage     -- ?skill_id={uuid}; proficiency distribution
  [*] GET    /api/v1/teams/{id}/member-capacity    -- capacity vs assigned workload per member

COMMENTS  (implemented for backlog items and tasks only)
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/comments
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/comments          -- { body, parent_id? }
  [*] GET    /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/comments
  [*] POST   /api/v1/projects/{id}/backlog/{item_id}/tasks/{task_id}/comments
  [*] PATCH  /api/v1/comments/{id}                                     -- [author] edit body
  [*] DELETE /api/v1/comments/{id}                                     -- [author or admin] soft delete
  -- Comments on epics, releases, stages, tests: schema supports it; API Phase 6b

STATS (Phase 6b -- not yet implemented)
  [ ] GET    /api/v1/projects/{id}/stats/overview
  [ ] GET    /api/v1/projects/{id}/stats/capacity
  [ ] GET    /api/v1/projects/{id}/stats/time
  [ ] GET    /api/v1/sprints/{id}/burndown
  [ ] GET    /api/v1/projects/{id}/velocity

GOALS (Phase 7 -- not yet implemented)
  [ ] GET/POST   /api/v1/projects/{id}/goals
  [ ] GET/PATCH/DELETE  /api/v1/goals/{id}
  [ ] PUT/DELETE /api/v1/goals/{id}/vote
  [ ] GET/POST/PATCH/DELETE  /api/v1/goals/{id}/items
  [ ] GET/POST/DELETE  /api/v1/goals/{id}/epics
  [ ] GET  /api/v1/goals/{id}/progress
  [ ] GET  /api/v1/projects/{id}/goals/priority
  [ ] GET  /api/v1/projects/{id}/goals/matrix
  [ ] GET  /api/v1/projects/{id}/goals/recommendation

REAL-TIME (Phase 7 -- not yet implemented)
  [ ] GET    /api/v1/projects/{id}/events    -- SSE: item updates, status changes, new comments
```

---

## Соглашения по API

**Ответ всегда одной формы:**
```json
{
  "data": { ... },
  "meta": { "total": 42, "page": 1, "per_page": 20 },
  "error": null
}
```

При ошибке:
```json
{
  "data": null,
  "meta": null,
  "error": { "code": "VALIDATION_ERROR", "message": "title is required" }
}
```

**Коды ошибок** -- строки, не числа. Клиент switch-ует по `error.code`.

**PATCH -- только изменившееся.** Для смены статуса задачи:
```json
PATCH /api/v1/backlog/abc123
{ "status": "in_progress" }
```
Не нужно слать весь объект. Сервер применяет только то, что пришло.

**Drag-and-drop reorder** -- специальный эндпоинт:
```json
PATCH /api/v1/projects/{id}/backlog/reorder
{ "items": [{ "id": "abc", "priority": 0 }, { "id": "def", "priority": 1 }] }
```
Атомарно, транзакционно.

---

## План реализации

### Фаза 0 -- Фундамент ✓ DONE (commit af2a044, fe8984e)
- [x] `go mod init`, структура директорий
- [x] `Dockerfile` (multi-stage: build + minimal runtime)
- [x] `docker-compose.yml`: postgres + adminer (порт 8081, для дебага схемы)
- [x] `Makefile`: `make dev`, `make build`, `make migrate-up`, `make migrate-down`, `make sqlc`
- [x] `config.go`: читаем `.env`, валидируем при старте (нет конфига -- не запускается)
  - Production guard: если `APP_ENV=production` и `SEED_ADMIN_PASSWORD=changeme` -- падаем с явной ошибкой
- [x] Подключение к БД с healthcheck
- [x] `golang-migrate` setup, первая пустая миграция
- [x] `chi` router, базовый `/api/v1/health` endpoint
- [x] CORS middleware (`cors.go`): разрешаем React dev server (`:5173`) и production origin
- [x] Rate limit middleware (`ratelimit.go`): применяем к `/api/v1/auth/login` + `/auth/refresh` (IP-based, burst=10 then 1/6s per IP)
- [x] Логгер (structured JSON logs)

### Фаза 1 -- Схема данных ✓ DONE
- [x] Все миграции из раздела "Схема" выше -- `000002_schema.up.sql`
- [x] `sqlc.yaml` config, базовые queries для всех таблиц
- [x] `make sqlc` -- генерируем Go-код
- [x] Проверяем на реальной БД (adminer -- наш друг)

### Фаза 2 -- Auth ✓ DONE (см. PHASE2_SUMMARY.md)
- [x] `POST /auth/login` -- bcrypt check, JWT access token + httpOnly refresh cookie
- [x] `POST /auth/refresh` -- token rotation, reuse detection (replay → RevokeAll)
- [x] `POST /auth/logout` -- revoke refresh token, idempotent
- [x] `GET /auth/me` -- profile from JWT claims
- [x] JWT middleware -- Bearer validation, `*auth.Claims` injected into context
- [x] Role middleware -- `RequireRole(...)`, chains after JWTAuth
- [x] Rate limiter -- burst=10 then 1/6s per IP; `Retry-After` header; X-Forwarded-For bypass blocked
- [x] Seed admin -- `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` at startup
- [x] 15 integration tests; 4 security review rounds; 16 bugs found and fixed

### Фаза 3 -- Пользователи и команды ✓ DONE
- [x] CRUD users (GET list, POST, GET by id, PATCH -- с role/active guard-цепочкой)
- [x] CRUD skills -- каталог (GET list, POST [admin]; ErrConflict → 409)
- [x] CRUD member_skills (GET, PUT upsert, DELETE -- idempotent)
- [x] CRUD teams + team members (GET, POST, PATCH, DELETE; UPSERT capacity_hours)
- [x] 61 integration tests; 3 review + 1 monkey round; 19 bugs found and fixed
  - validation: null bytes, trim, length limits (name 200, skill 100, avatar_url 2048)
  - admin self-deactivation guard (403)
  - malformed UUID → 404 on all DELETE handlers
  - ErrConflict / ErrNotFound propagation сквозь store → handler

### Фаза 4 -- Рабочие элементы ✓ DONE (см. PHASE4_SUMMARY.md)
- [x] CRUD projects (archive via PATCH status, admin DELETE)
- [x] CRUD epics (с базовым прогрессом через поле status)
- [x] CRUD backlog items (с фильтрацией по всем измерениям)
- [x] Reorder: `POST /projects/{id}/backlog/reorder` (FLOAT8 midpoint trick)
- [x] CRUD tasks
- [x] CRUD tests (на всех уровнях: project / epic / backlog item)
- [x] Time logging
- [x] CRUD comments (soft delete + one-level threading; 24h edit window -- pending)
- [x] 136 integration tests (cumulative); 2 audit passes; 39 bugs found and fixed

### Фаза 4.5 -- Спринты ✓ DONE
- [x] CRUD sprints
- [x] Sprint items: добавление/удаление/список backlog items из спринта
- [x] Sprint test runs: инициализация результатов при старте спринта
- [x] Auto-skip логика при failed тесте (domain/testrun.go)
- [ ] Sprint board view: `GET /sprints/{id}/board` (Phase 5)

### Фаза 5 -- Таймлайн (2-3 дня)
- [ ] CRUD releases
- [ ] CRUD stages
- [ ] Привязка backlog items к stage/release

### Фаза 6 -- Ясность, Риск и Аналитика (6-8 дней)

Цель фазы: сделать невидимое видимым. Не только "сколько сделали", но и
"насколько понимали что делаем". Основа -- квадранты недопонимания (см. IDEAS.md).

#### 6a -- Модель ясности (2-3 дня)

**Миграция 000007** -- добавляем `clarity_level` на ключевые сущности.
_(000006 занята: `users.theme` -- тема пользователя, сохраняемая на сервере)_

Уровни основаны на фреймворке Cynefin (Дэвид Сноуден): каждый домен требует
своего подхода к принятию решений, оценке рисков и управлению.

```sql
CREATE TYPE clarity_level AS ENUM (
    'unknown',  -- disorder: ещё не разобрались даже с тем, в каком домене находимся;
                --           первый шаг -- не планировать, а исследовать
    'foggy',    -- chaos: усилие != результат; долгая упорная работа может не дать ничего,
                --        а случайное озарение -- решить задачу легко и с заделом;
                --        нужен spike или эксперимент, не оценка
    'tacit',    -- complex (экспертный): территория инженерии, дизайна, архитектуры;
                --                           поиск с заданными параметрами; решение есть,
                --                           но его нужно найти и обосновать
    'scoped',   -- complicated (организационный): задача понятна, но есть орг. сложности;
                --                               процесс не налажен, логистика не настроена;
                --                               open questions идентифицированы
    'clear'     -- simple: производство; всё промерено, best practices прописаны,
                --          команда на уровне; берём в спринт без spike
);

ALTER TABLE backlog_items ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
ALTER TABLE epics         ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
ALTER TABLE tasks         ADD COLUMN clarity_level clarity_level NOT NULL DEFAULT 'unknown';
```

Новые sqlc queries:
- `UpdateBacklogItemClarity(id, clarity_level)` -- PATCH отдельным эндпоинтом
- `ListBacklogItemsByClarity(project_id, clarity_level)` -- фильтрация для grooming view
- `GetProjectClarityDistribution(project_id)` -- COUNT по каждому уровню
- `GetSprintClaritySnapshot(sprint_id)` -- clarity_level айтемов на момент старта спринта

API эндпоинты:
- `PATCH /projects/{id}/backlog/{item_id}/clarity` -- обновить clarity_level
- `GET  /projects/{id}/clarity-map` -- distribution по всем айтемам проекта
- `GET  /projects/{id}/backlog?clarity=foggy` -- фильтр беклога по clarity (расширение существующего)
- `GET  /sprints/{id}/risk-score` -- вычисленный risk score по формуле из IDEAS.md

Sprint risk score:
```
score = (foggy*4 + unknown*3 + tacit*2 + scoped*1 + clear*0) / total_items
```
Возвращается вместе с breakdown по квадрантам. Никаких светофоров -- только данные.

#### 6b -- Аналитика и статистика (3-4 дня)

Три уровня аналитики (согласно IDEAS.md раздел 3):

**Оперативный уровень** (для тимлида еженедельно):
- `GET /teams/{id}/load` -- кто сколько взял, кто перегружен, кто простаивает
  Ответ: `{ member_id, name, capacity_hours, assigned_hours, utilization_pct }`
- `GET /sprints/{id}/burndown` -- items и часы по дням спринта (actual vs planned)
  Requires: `time_logs` таблица (новая миграция 000008, см. ниже)

**Тактический уровень** (для планирования релиза):
- `GET /projects/{id}/velocity` -- нормализованная velocity по спринтам
  `velocity = story_points_done / available_capacity` (не абсолютные цифры)
- `GET /teams/{id}/skill-throughput` -- tasks_done_in_skill / available_hours_in_skill
  Отвечает: "насколько эффективно используются Python-компетенции в квартале"
- `GET /projects/{id}/epic-progress` -- прогресс каждого эпика (% закрытых айтемов)

**Агрегированный overview** (дашборд проекта):
- `GET /projects/{id}/overview` -- всё в одном: items by status, sprint health,
  fog distribution, capacity utilization, top blocked items

**Миграция 000008** -- time_logs (нужна для burndown и аналитики):
```sql
CREATE TABLE time_logs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id        UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    user_id        UUID NOT NULL REFERENCES users(id),
    logged_hours   NUMERIC(5,2) NOT NULL CHECK (logged_hours > 0),
    logged_date    DATE NOT NULL DEFAULT CURRENT_DATE,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_time_logs_task   ON time_logs(task_id);
CREATE INDEX idx_time_logs_user   ON time_logs(user_id);
CREATE INDEX idx_time_logs_date   ON time_logs(logged_date);
```

API для time_logs:
- `POST /tasks/{id}/time-logs` -- залогировать время
- `GET  /tasks/{id}/time-logs` -- история по задаче
- `GET  /users/{id}/time-logs?from=&to=` -- история по пользователю за период

---

### Фаза 3c -- Multi-team projects ✓ DONE (миграция 000010)

**Суть проблемы:** `projects.team_id` -- жёсткий FK на одну команду. В реальности:
QA-инженер работает на трёх проектах. DevOps -- на всех. У проекта есть dev-команда,
QA-команда и команда поддержки. Каждая со своим capacity, своими спринтами, своими навыками.

**Новая модель:** M:M через `project_teams`. Проект принадлежит нулю или нескольким командам.
Команда работает на нескольких проектах. Sprint `team_id` -- сохраняется (один тим проводит
один спринт; у QA-команды свои спринты, у dev-команды свои).

#### Миграция 000009 -- project_teams

```sql
-- Step 1: create junction table
CREATE TABLE project_teams (
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    team_id     UUID NOT NULL REFERENCES teams(id)    ON DELETE CASCADE,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, team_id)
);
CREATE INDEX idx_project_teams_project ON project_teams(project_id);
CREATE INDEX idx_project_teams_team    ON project_teams(team_id);

-- Step 2: migrate existing data (zero data loss)
INSERT INTO project_teams (project_id, team_id)
    SELECT id, team_id FROM projects WHERE team_id IS NOT NULL;

-- Step 3: drop the old FK column
ALTER TABLE projects DROP COLUMN team_id;
```

Down migration (000009.down.sql):
```sql
ALTER TABLE projects ADD COLUMN team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- restore best-guess: first team added per project (arbitrary but lossless for v1 data)
UPDATE projects p SET team_id = (
    SELECT team_id FROM project_teams pt
    WHERE pt.project_id = p.id
    ORDER BY pt.added_at
    LIMIT 1
);

DROP TABLE project_teams;
```

#### Бэкенд изменения

**Middleware `projectVisibility`** -- поменять SQL:
```go
// Before (v1):
// WHERE p.team_id IN (SELECT team_id FROM team_members WHERE user_id = $me)
// After (v2):
const q = `
  SELECT EXISTS (
      SELECT 1 FROM project_teams pt
      JOIN team_members tm ON tm.team_id = pt.team_id
      WHERE pt.project_id = $1 AND tm.user_id = $2
  )
`
```

**`GET /projects?team_id={id}`** -- запрос через `project_teams`:
```sql
-- Before: WHERE p.team_id = $1
-- After:
SELECT p.* FROM projects p
JOIN project_teams pt ON pt.project_id = p.id
WHERE pt.team_id = $1
```

**`POST /projects`** -- body больше не требует `team_id`.
Опциональный `team_id` в body: если передан -- сразу создаётся запись в `project_teams`.

**Новые endpoints:**
```
GET    /projects/{id}/teams              -- список команд проекта
POST   /projects/{id}/teams             -- { team_id } -- добавить команду на проект
DELETE /projects/{id}/teams/{team_id}   -- убрать команду с проекта
```

**sqlc queries (обновить):**
- `ListProjectsByTeam(team_id)` -- через JOIN `project_teams`
- `ListTeamsByProject(project_id)` -- новый
- `AddTeamToProject(project_id, team_id)` -- INSERT
- `RemoveTeamFromProject(project_id, team_id)` -- DELETE
- `UserCanAccessProject(user_id, project_id)` -- EXISTS через `project_teams`

#### Фронтенд изменения

- `ProjectsPage` (`/teams/:id/projects`): без изменений -- `?team_id` работает
- `ProjectOverviewPage`: добавить секцию **Teams** -- список команд + кнопка "Add team" (admin/maintainer)
- Модалка создания проекта: опционально добавить drop-down "Add to team" -- или сделать в два шага
- `TeamDetailPage`: секция "Projects" -- уже показывает проекты через `/projects?team_id=` -- работает

#### Затронутые файлы

| Слой | Файл | Что меняем |
|------|------|------------|
| DB | `migrations/000009_project_teams.{up,down}.sql` | новый |
| DB | `db/queries/projects.sql` | ListProjectsByTeam, UserCanAccessProject |
| DB | `db/queries/project_teams.sql` | новый файл |
| Go | `internal/api/middleware/roles.go` | projectVisibility SQL |
| Go | `internal/api/handler_projects.go` | list, create, + 3 new handlers |
| Go | `internal/api/router.go` | 3 new routes |
| TS | `frontend/src/api/projects.ts` | listTeams, addTeam, removeTeam |
| TS | `frontend/src/pages/ProjectOverviewPage.tsx` | Teams section |

**Оценка:** 1-2 дня. Миграция нулевых потерь данных. Rollback через down-скрипт.

---

### Фаза 7 -- SSE Real-time (2-3 дня)

SSE endpoint позволяет клиентам подписаться на поток событий без polling.
Один постоянный HTTP-соединение, события в формате `text/event-stream`.

**Broadcaster:**
Горутина внутри процесса. Каналы per-project (map[projectID][]chan Event).
При горизонтальном масштабировании -- заменить на Kafka/NATS (outbox готов).
Сейчас: один инстанс, этого достаточно для v1.

**Эндпоинт:**
```
GET /projects/{id}/events
Content-Type: text/event-stream
Cache-Control: no-cache
Authorization: Bearer <token>   (JWT в query param как fallback для EventSource)
```

**Типы событий:**

| event type             | когда                                          | payload                              |
|------------------------|------------------------------------------------|--------------------------------------|
| `item.status_changed`  | backlog_item.status изменился                  | `{id, old_status, new_status}`       |
| `item.clarity_changed` | backlog_item.clarity_level изменился           | `{id, old_clarity, new_clarity}`     |
| `item.reordered`       | после drag-and-drop reorder                    | `{project_id}`  (клиент перезапросит)|
| `sprint.started`       | sprint.status = active                         | `{sprint_id, name}`                  |
| `sprint.completed`     | sprint.status = completed                      | `{sprint_id, velocity}`              |
| `task.assigned`        | task.assignee_id изменился                     | `{task_id, assignee_id, name}`       |
| `comment.created`      | новый комментарий                              | `{comment_id, author, body_preview}` |
| `fog.alert`            | sprint risk score превысил порог (> 1.5)       | `{sprint_id, score, foggy_count}`    |
| `ping`                 | каждые 30 секунд для keep-alive                | `{ts}`                               |

**Fog alert** -- новое: когда кто-то меняет clarity_level и risk score спринта
пересекает порог, broadcaster рассылает `fog.alert` всем подписчикам проекта.
Это не блокировка -- это сигнал для planning meeting.

**Go реализация (структура):**

```go
// internal/api/sse.go
type SSEBroker struct {
    mu       sync.RWMutex
    channels map[string][]chan SSEEvent  // key = project_id
}

type SSEEvent struct {
    Type    string `json:"type"`
    Payload any    `json:"payload"`
}

func (b *SSEBroker) Subscribe(projectID string) (<-chan SSEEvent, func())
func (b *SSEBroker) Publish(projectID string, event SSEEvent)
```

Handler пишет в `w` в цикле пока клиент не отключится (context.Done()).
При отключении вызывает unsubscribe функцию (убирает канал из map).

**Интеграция с handlers:**
После каждого successful PATCH status или PATCH clarity в handler --
`broker.Publish(projectID, SSEEvent{Type: "item.status_changed", ...})`.
Broker живёт в Router как зависимость (передаётся в handlers через конструктор).

### Фаза 8 -- React UI (не "потом", а параллельно с каждой фазой)

UI строится итерационно -- каждый шаг синхронизирован с соответствующим бэкенд-этапом.
Точка входа после логина -- **команда**, не проекты. Человек в системе первичен.

Общий техстек (один раз, в самом начале):
- Vite + React 18 + TypeScript
- TanStack Query v5 -- data fetching, кэш, invalidation
- Zustand -- глобальный state (auth, текущая команда/проект, SSE-события)
- Axios + JWT interceptor (auto-refresh через refresh token)
- React Router v6 -- структура маршрутов
- shadcn/ui + Tailwind CSS -- дизайн-система

---

#### Фаза 8.0 -- Vite Foundation + Auth UI (параллельно с Фазой 2 | уже можно)

Бэкенд Фазы 2 сделан. UI можно начинать прямо сейчас.

- [x] Vite + TS + Tailwind v4 + React Router v7 -- инициализация проекта
- [x] Axios instance: `baseURL`, request/response interceptors, token refresh logic
- [x] Zustand: `useAuthStore` -- user, accessToken, setAuth, logout, refresh, loadMe
- [x] `POST /auth/login` -- login form, валидация (zod + react-hook-form), error display
- [x] `POST /auth/refresh` -- автоматически при 401, прозрачно для компонентов
- [x] Protected route wrapper -- redirect to `/login` если нет токена
- [x] `GET /auth/me` -- загрузка текущего пользователя при старте
- [x] `POST /auth/logout` -- очистка стора, redirect
- [x] Playwright E2E: auth flow tests (e2e/auth.spec.ts) -- 4/4 pass

---

#### Фаза 8.1 -- Design System & Theme Engine (предусловие для всех следующих фаз)

Закладывается один раз, используется везде. Без этого фундамента каждый следующий экран
будет стилизован "на глаз" и окажется несовместим с предыдущим.

**Принципы:**
- UI language: **English only.** No mixed-language labels -- ever.
- Density: compact but not cramped. Information fits the screen; scrolling is the exception.
- Readability first: contrast, type scale, line-height. Everything else is secondary.
- Theming via CSS custom properties (`data-theme` attribute on `<html>`). Zero runtime JS cost.

---

**Темы (реестр):**

| ID              | Family | Character                                                           | Default |
|-----------------|--------|---------------------------------------------------------------------|---------|
| `deep-dive`     | Dark   | Deep navy, electric-blue accent. Focus mode -- zero distraction.    | YES     |
| `night-sky`     | Dark   | Near-black with indigo tones. Warmer than DeepDive.                 |         |
| `classic-dark`  | Dark   | Classic dark grey like most IDEs. Familiar, safe.                   |         |
| `ocean-blue`    | Light  | Cool blue-grey surfaces, crisp borders. Professional daytime.       |         |
| `paper-white`   | Light  | Off-white + warm accents. Easy on the eyes in natural light.        |         |
| `sunrise`       | Light  | Warm amber tones. Energetic, high-contrast.                         |         |
| `high-contrast` | Any    | WCAG AAA -- black/white base + saturated accent. For color-blind.   |         |

Пользователь выбирает тему в своём профиле. Сохраняется в `localStorage` + на сервере (Phase 6+).

---

**Цветовые токены (CSS custom properties per theme):**

```
-- Layer colors --
--bg-base        base page background
--bg-surface     cards, panels
--bg-elevated    dropdowns, popovers, modals
--bg-hover       interactive hover state
--bg-active      selected/active item

-- Text --
--text-1         primary: headings, labels
--text-2         secondary: descriptions, subtitles
--text-3         muted: timestamps, metadata, placeholders

-- Accent (primary action) --
--accent         button bg, links, focus rings
--accent-hover
--accent-fg      text on accent bg (always passes WCAG AA)

-- Semantic --
--color-success  done, passing tests
--color-warning  at-risk, needs attention
--color-danger   blocked, failed, overdue
--color-info     neutral callouts

-- Chrome --
--border         default border (subtle)
--border-strong  emphasized dividers, table headers
--shadow-sm      subtle elevation
--shadow-md      modal / popover elevation
```

**DeepDive tokens (reference implementation):**

```css
/* Deep ocean abyss -- bioluminescent accent, zero warmth */
[data-theme="deep-dive"] {
  --bg-base:      #050d14;
  --bg-surface:   #0a1a24;
  --bg-elevated:  #0f2535;
  --bg-hover:     #163040;
  --bg-active:    #1c3c50;

  --text-1:  #c8e4ef;
  --text-2:  #5a8fa8;
  --text-3:  #2e5468;

  --accent:       #00c4b8;   /* bioluminescent teal */
  --accent-hover: #00e5d4;
  --accent-fg:    #001a18;

  --color-success: #10b89a;
  --color-warning: #f59e0b;
  --color-danger:  #e05555;
  --color-info:    #22d3ee;

  --border:        rgba(0 180 220 / 0.07);
  --border-strong: rgba(0 180 220 / 0.14);
  --shadow-sm: 0 1px 3px rgba(0 0 0 / 0.5);
  --shadow-md: 0 8px 24px rgba(0 0 0 / 0.7);
}
```

---

**Типографика:**

Font: **Inter Variable** (`@fontsource-variable/inter`) -- shipped with the bundle, no CDN.
Fallback: `system-ui, sans-serif`.
Mono (code, IDs, hashes): `'JetBrains Mono', 'Fira Code', monospace`.

| Scale token  | Size  | Weight | Use                                     |
|--------------|-------|--------|-----------------------------------------|
| `--text-xs`  | 11px  | 400    | badges, table metadata                  |
| `--text-sm`  | 13px  | 400    | body, form labels, sidebar items        |
| `--text-base`| 14px  | 400    | default body                            |
| `--text-md`  | 15px  | 500    | card titles, section headers            |
| `--text-lg`  | 18px  | 600    | page headings                           |
| `--text-xl`  | 22px  | 700    | primary view title                      |

Line-height: `1.5` for body, `1.25` for headings. No orphan lines.

---

**Плотность и сетка:**

Базовая единица: `4px`. Все отступы кратны 4.

| Context              | Padding         | Gap    |
|----------------------|-----------------|--------|
| Page container       | `24px` H        |        |
| Card / panel         | `16px`          |        |
| Compact table row    | `8px` V / `12px` H | `8px`  |
| Sidebar item         | `8px` V / `12px` H |        |
| Form group           | `12px` bottom   |        |
| Inline badge         | `2px` V / `6px` H |        |

---

**Длинные строки и таблицы:**

- Text cells: `truncate` (`text-overflow: ellipsis`) по умолчанию + `title` tooltip с полным текстом.
- Многострочность включается классом `.multiline` или настройкой пользователя.
- Таблицы: drag-to-reorder columns (dnd-kit), resize handle, per-column visibility toggle.
  Настройки сохраняются в `localStorage` под ключом `v42-table-prefs:{viewName}`.
- Минимальная ширина колонки: `60px`. Максимум по умолчанию: `320px`.

---

**Checklist:**

- [x] `@fontsource-variable/inter` -- установить, импортировать в `index.css`
- [x] `index.css` -- полный реестр CSS-токенов для всех 8 тем
- [x] `src/stores/useTheme.ts` -- Zustand store: `theme`, `setTheme()`, persist в localStorage
- [x] `src/components/ThemeProvider.tsx` -- ставит `data-theme` на `<html>` при монтировании и смене
- [x] `main.tsx` -- обернуть приложение в `<ThemeProvider />`
- [x] `src/lib/cn.ts` -- утилита `cn(...classes)` (clsx + tailwind-merge)
- [x] Переписать `LoginPage` и `DashboardPage` под токены DeepDive
- [x] Smoke test: смена темы в `localStorage` -- страница перерисовывается правильно
- [x] **BONUS:** Тема сохраняется на сервере (`users.theme`, migration 000006, `PATCH /auth/me`)
- [x] **BONUS:** WebGL2 bubble easter egg -- 3 режима (classic / rainbow / вращающиеся квадраты) + idle detection 30s
- [x] **BONUS:** DeepDive и NightSky разведены -- разные палитры, разные характеры
- [x] **BONUS:** Тема `new-york` -- тёплый асфальт, cab yellow accent (migration 000008)

---

#### Фаза 8.3 -- Команды и люди (параллельно с Фазой 3 | уже можно)

Бэкенд Фазы 3 сделан. Teams UI -- первый экран после логина.
Человек видит свои команды, а не список абстрактных проектов.

**Лэйаут и навигация:**
- [x] App shell: левый sidebar (команды, быстрые ссылки), header (профиль, logout)
- [x] После логина → `/teams` (список команд пользователя, не `/projects`)
- [x] `GET /teams` -- список команд текущего пользователя (фильтр по member)

**Team list** (`/teams`):
- [x] Карточки команд с названием, описанием, датой создания -- клик → `/teams/{id}`
- [x] Empty state с иллюстрацией

**Team dashboard** (`/teams/{id}`):
- [x] Члены команды: имя, email, роль (с цветом по токену), capacity_hours
- [x] Статистика: кол-во участников, суммарная ёмкость, дата создания
- [x] Skeleton при загрузке, back link → `/teams`, error state
- [x] Skill radar (recharts RadarChart): покрытие навыков в команде (`GET /teams/{id}/skill-matrix`)
- [x] Capacity bars: available h/wk per member + active sprint item count (`GET /teams/{id}/member-capacity`)
- [x] Tandem opportunities UI: кто кого может менторить (`GET /teams/{id}/tandems`)
- [x] Learning appetite UI: кто хочет расти в каком навыке (`GET /teams/{id}/learning-appetite`)

**Управление командой** (admin/maintainer):
- [x] Добавить члена команды (форма: user dropdown + capacity)
- [x] Удалить члена команды
- [x] Обновить capacity_hours члена
- [x] `GET /skills` -- каталог навыков для выбора
- [x] Редактировать название / описание команды (`PATCH /teams/{id}`, inline форма в хедере TeamDetailPage)
- [x] Создать команду (кнопка "New team" в хедере `/teams`, inline форма; только admin/maintainer)
- [x] Удалить команду (`DELETE /teams/{id}`, confirm-диалог в хедере TeamDetailPage; только admin)

**Профиль пользователя** (`/profile`):
- [x] Страница `/profile` -- аватар, имя, email, роль, дата регистрации
- [x] Theme switcher перенесён сюда из sidebar (8 тем, активная выделена)
- [x] Список навыков пользователя (уровень + interest badge + note)
- [x] Добавить / редактировать / удалить навык (`PUT /users/{id}/skills/{skill_id}`)
- [x] Список команд пользователя
- [x] Sidebar bottom: аватар+имя → link `/profile`; только кнопка sign out
- [x] Ссылка на смену пароля → `/change-password`
- [x] Skill radar (персональный): мои компетенции по Дрейфусу (`GET /users/{id}/skill-radar`)
- [x] Learning appetite: trajectory (куда хочу расти) (`GET /users/{id}/learning-appetite`)
- [x] Engagement score: calibration -- grounded experts vs declared (`GET /users/{id}/engagement`)

**Безопасность и администрирование:**
- [x] `ChangePasswordPage` (`/change-password`) -- всегда 3 поля: текущий + новый + подтверждение
- [x] Backend: current_password всегда верифицируется (no skip)
- [x] Forced flow: `must_change_password=true` → redirect до входа в приложение
- [x] Migration 000007: `users.must_change_password BOOLEAN NOT NULL DEFAULT false`
- [x] `AdminUsersPage` (`/admin/users`) -- список, создать, активировать/деактивировать, сбросить пароль
- [x] autoComplete на всех password-полях формы (защита от autofill-бага браузера)

---

#### Фаза 8.4 -- Проекты и беклог (параллельно с Фазой 4) ✓ PARTIAL DONE

Проекты открываются из контекста команды. `/teams/{id}/projects` -- не отдельный раздел.

**Project list:**
- [x] `GET /projects?team_id={id}` -- проекты команды (`projectsApi.list`)
- [x] Карточка проекта: название, статус (active / on_hold / completed / archived)
- [x] Создать проект (модалка: название, описание; team_id из URL)
- [ ] PATCH статуса проекта (заглушка в ProjectOverviewPage -- "coming soon")
- [ ] % закрытых айтемов, fog distribution mini-bar -- нет данных с бэкенда
- [ ] **[v2]** Create project modal: immediately link to creating team via `project_teams`
- [ ] **[v2]** `ProjectOverviewPage`: секция "Teams on this project" -- список + добавить/убрать команду

**Project shell** (`/projects/{id}`):
- [x] Tab-навигация: Overview / Backlog / Epics / Sprints
- [x] Breadcrumb: Teams → Projects → {name}
- [x] Status badge (active / on_hold / completed / archived)
- [x] `ProjectOverviewPage` -- быстрые ссылки на Backlog / Epics / Sprints + Danger Zone
- [ ] Stats: items by status, velocity, fog distribution -- отложено до Phase 8.6

**Backlog view** (`/projects/{id}/backlog`):
- [x] Список айтемов с фильтрами: status, clarity, epic_id
- [x] Clarity badge на каждой строке (4 цвета по квадранту)
- [x] Inline PATCH статуса: клик по бейджу статуса → меняет без перехода
- [x] Создать айтем: inline панель (title + type + epic)
- [x] Удалить айтем (с confirm)
- [ ] Grooming filter preset "Требуют уточнения" -- отложено
- [ ] Drag-and-drop сортировка (dnd-kit) -- `POST /backlog/reorder` готов, UI не сделан
- [x] Backlog item detail (`/projects/:id/backlog/:itemId`) -- полная страница:
  - Описание (редактируемое inline)
  - ATDD поля (ac_setup / ac_steps / ac_expected, read-only)
  - Задачи (Tasks): CRUD, статус, skill_required (inline edit), estimate
  - Тесты (Tests): CRUD, type, steps, expected_results
  - Skill Load Distribution: агрегированный bar по skill_required задач
  - Кнопка "+ Sprint" -- выбор planning/active спринта и добавление айтема

**Epic board** (`/projects/{id}/epics`):
- [x] Карточки эпиков: title, status badge
- [x] Создать эпик (inline панель: title + description)
- [x] Переименовать эпик (клик по title → inline edit)
- [x] Сменить статус эпика (dropdown)
- [x] Удалить эпик (с confirm)
- [ ] Progress bar (% done backlog items) -- нет агрегатов с бэкенда
- [ ] Клик → backlog с фильтром epic_id -- отложено

**Роутинг и связность:**
- [x] `/teams/:id/projects` -- `ProjectsPage`
- [x] `/projects/:projectId` -- `ProjectShell` + `ProjectOverviewPage`
- [x] `/projects/:projectId/backlog` -- `BacklogPage`
- [x] `/projects/:projectId/epics` -- `EpicsPage`
- [x] Ссылка "Projects" на `TeamDetailPage` (кнопка-ряд)

**Тесты (Playwright e2e):**
- [x] `e2e/projects.spec.ts` -- 14 структурных тестов (без бэкенда): redirect guards, page structure, modal open/close, form disable state
- [ ] Backend flow тесты (CRUD) -- 3 теста написаны, пропускаются без `RUN_E2E_WITH_BACKEND=1`

---

#### Фаза 8.4.5 -- Sprint board (параллельно с Фазой 4.5) ✓ PARTIAL DONE

- [x] Список спринтов проекта, создать спринт, статус (planning / active / completed)
- [x] Sprint detail: дата начала/конца, capacity команды, кол-во айтемов
- [ ] Risk score badge на заголовке: цвет по порогу (< 0.5 зелёный, 0.5-1.5 жёлтый, > 1.5 красный)
  - `GET /sprints/{id}/risk-score`
- [x] Sprint board: колонки open / in_progress / in_review / done (dnd-kit DndContext)
- [x] Drag карточки между колонками -- `PATCH /backlog/{id}` со статусом
- [x] Добавить айтем из спринта -- панель "Add from backlog" в футере борда (фильтр + поиск + кнопка +)
- [x] Удалить айтем из спринта -- через `DELETE /sprints/{id}/items/{backlog_item_id}` (хук готов)
- [ ] Fog alert toast: SSE событие `fog.alert` -- откладывается до Phase 8.7

---

#### Фаза 8.4.8 -- Коррекция курса (UX / polish)

Промежуточная фаза: исправляем накопившиеся огрехи до движения вперёд.

- [ ] **Пасхалка**: пузыри активируются только в левом нижнем углу (fix click zone, сейчас срабатывает везде)
- [ ] **Session timeout**: честный logout с настройкой в профиле пользователя
  - `idle_timeout_minutes` в `PATCH /api/v1/users/me` (default 30, 0 = никогда)
  - Frontend: читаем из профиля, idle timer через `mousemove`/`keydown`, показываем предупреждение за 1 мин до logout
- [ ] **Theme picker**: дропдаун в ProfilePage вместо кликабельных плашек; цветовой индикатор сохраняется
- [ ] **TeamDetailPage layout**: горизонтальный 16:9 -- список 2/3, радар + статистика 1/3, без мобильного сжатия
- [ ] **Add member widget**: позиционирование в пределах viewport (overflow-hidden на контейнере + dropup если нет места снизу)
- [ ] **Skill radar**: вынести из центра на правую колонку рядом со списком команды
- [ ] **Контраст текста**: увеличить `--text-1` / `--text-2` в светлых темах (OceanBlue, PaperWhite, Sunrise); цель WCAG AA (4.5:1)
- [ ] **Сайдбар**: прямой доступ -- секция "Last project" с ссылками на Backlog и Sprints выбранного проекта
- [ ] **Persistence**: `localStorage` сохраняет последний проект, активные фильтры, текущую страницу пагинации; восстанавливается при логине

---

#### Фаза 8.5 -- Таймлайн (параллельно с Фазой 5)

- [ ] Горизонтальная шкала времени (кастомный SVG или vis-timeline -- решить по ходу)
- [ ] Полосы Release: название, период, цвет по статусу
- [ ] Полосы Stage внутри Release: вложенно, с датами
- [ ] Epic bars: span от первого до последнего айтема в эпике (auto-computed)
- [ ] Backlog items в Stage: точки или мини-карточки на полосе
- [ ] Fog heat-map наложение: интенсивность фона по fog-density в периоде
  (много foggy айтемов в этапе → тёмный фон этапа → концентрация риска видна сразу)
- [ ] Drag stage/release для изменения дат → `PATCH /releases/{id}` или `PATCH /stages/{id}`
- [ ] Привязать айтем к stage: drag с backlog на полосу, или select в item detail

---

#### Фаза 8.6 -- Ясность и аналитика (параллельно с Фазой 6)

Clarity controls уже встроены в backlog (8.4). Здесь -- аналитическая надстройка.

- [ ] Clarity map view (`/projects/{id}/clarity`): quadrant distribution в виде bubble chart
  - Каждый пузырь = один айтем, ось X = приоритет, ось Y = quadrant, размер = estimate
- [ ] Time logging UI: кнопка "Залогировать время" на task detail, форма (часы + дата + заметка)
  - `POST /tasks/{id}/time-logs`
- [ ] Burndown chart: actual vs planned по дням спринта (recharts LineChart)
  - `GET /sprints/{id}/burndown`
- [ ] Velocity chart: нормализованная velocity по спринтам (recharts BarChart)
  - `GET /projects/{id}/velocity`
- [ ] Team load view (`/teams/{id}/load`): кто перегружен, кто простаивает
  - Таблица: member, capacity_hours, assigned_hours, utilization_pct, colored bar
- [ ] Skill throughput: гистограмма эффективности по навыкам
  - `GET /teams/{id}/skill-throughput`

---

#### Фаза 8.7 -- Real-time (параллельно с Фазой 7)

Не добавляет новых экранов -- добавляет живость к уже существующим.

- [ ] `useProjectEvents(projectId)` hook -- EventSource с auto-reconnect
  - Exponential backoff: 1s → 2s → 4s → 8s → max 30s
  - Reconnect при visibilitychange (вернулся с другой вкладки)
- [ ] Zustand event handler: обновляет QueryClient кэш по типу события
  - `item.status_changed` → invalidate backlog query (без перезагрузки страницы)
  - `item.clarity_changed` → invalidate clarity-map + backlog
  - `sprint.started` / `sprint.completed` → invalidate sprint list
  - `fog.alert` → toast notification (shadcn Toast, не блокирующий)
- [ ] Оптимистичное обновление при drag-and-drop:
  - Zustand применяет изменение немедленно
  - При HTTP ошибке → rollback + error toast
- [ ] Online indicator: зелёная точка в header пока SSE соединение активно



### Фаза 9 -- Цели (Goals Layer) (5-8 дней)

Новый слой "почему" над "что и как". Не заменяет эпики -- дополняет другим измерением.

#### 9a -- Схема и API Core (2-3 дня)

- [ ] Миграция 000010:
  - `ALTER TABLE sprints RENAME COLUMN goal TO sprint_goal` (избежать путаницы с entity)
  - `CREATE TYPE goal_status ...`
  - `CREATE TABLE goals`, `goal_votes`, `goal_items`, `goal_epics`
- [ ] Обновить все sqlc queries для `sprints.goal` -> `sprints.sprint_goal`
- [ ] Новый файл `db/queries/goals.sql`: все CRUD + vote upsert + progress query
- [ ] `make sqlc` -- регенерировать
- [ ] CRUD Goals API:
  - `GET/POST /projects/{id}/goals`
  - `GET/PATCH/DELETE /goals/{id}`
- [ ] Vote API: `PUT/DELETE /goals/{id}/vote`, `GET /goals/{id}/votes`
- [ ] Items linking: `GET/POST /goals/{id}/items`, `PATCH/DELETE /goals/{id}/items/{id}`
- [ ] Epic alignment: `GET/POST /goals/{id}/epics`, `DELETE /goals/{id}/epics/{id}`
- [ ] Goal progress: `GET /goals/{id}/progress`

#### 9b -- Аналитика и приоритизация (2-3 дня)

- [ ] `GET /projects/{id}/goals/priority` -- авто-приоритет беклога по формуле:
  ```
  item_auto_priority = SUM(goal.importance * goal_item.necessity) / SUM(goal.importance)
  ```
  Возвращает отсортированный список с полем `auto_priority` + `contributing_goals[]`
- [ ] `GET /projects/{id}/goals/matrix` -- 2x2 матрица importance vs necessity per item:
  ```json
  { "do_first": [...], "schedule": [...], "discuss": [...], "parking": [...] }
  ```
- [ ] `GET /sprints/{id}/goal-coverage` -- насколько спринт покрывает активные Цели:
  ```json
  [{ "goal_id": "...", "importance": 80, "items_in_sprint": 3, "items_total": 12,
     "items_done": 1, "coverage_pct": 25 }]
  ```
- [ ] `GET /projects/{id}/goals/recommendation` -- жадный алгоритм:
  - сортировка по `auto_priority / estimate`
  - берём айтемы до исчерпания capacity
  - возвращаем список + дельту покрытия целей
- [ ] SSE события: `goal.achieved` (автоматически при 100% coverage) ->
  `broker.Publish(projectID, SSEEvent{Type: "goal.achieved", ...})`
- [ ] Integration tests: priority formula, matrix quadrants, coverage calc

#### 9c -- Frontend Goals UI (3-4 дня, параллельно с 9b)

- [ ] `GoalsPage` (`/projects/{id}/goals`):
  - Список Целей: title, importance bar (0-100), status badge, coverage % ring
  - Фильтр по status (draft / active / achieved / cancelled)
  - Кнопка "New Goal" -> inline форма
  - Голосование прямо в списке (1-5 звёзд, мой голос подсвечен)

- [ ] `GoalDetailPage` (`/projects/{id}/goals/{goalId}`):
  - Header: title, source, target_date, importance score + vote panel
  - Progress: ring chart (items done / total) + список достижений
  - 2x2 матрица: Do First / Schedule / Discuss / Parking (мини-версия)
  - Linked items: таблица беклог-айтемов с necessity slider + статус
  - Кнопка "Link items" -> поиск по беклогу + add

- [ ] `BacklogPage` расширение:
  - Новая колонка "Goals" (иконки связанных целей, tooltip с названиями)
  - Переключатель сортировки: "Manual" | "Auto-priority" (по `auto_priority`)
  - Overlay: если включён Auto-priority, строки получают цветовую полосу слева
    (интенсивность = auto_priority / 100)

- [ ] `SprintPage` расширение:
  - Секция "Goal Coverage" в хедере: мини-бары по активным Целям
  - Сколько % каждой Цели покрывается айтемами этого спринта
  - Зелёный если > 50%, жёлтый если 20-50%, красный если < 20%

- [ ] Добавить Goals в ProjectShell nav tab: Overview / Backlog / Epics / Goals / Sprints

---

### Фаза 10 -- Умная аналитика и knowledge map (future, v2)

Когда данных накопится достаточно (3-6 месяцев работы с системой).

- [ ] Clarity trend по спринтам: как менялся fog-distribution со временем
- [ ] Bus factor alerts: автоматическое обнаружение skill = tacit по истории задач
  (навык у одного человека + он закрыл >70% задач в этом навыке = alert)
- [ ] Fog-to-clear trajectory: среднее время от unknown до clear по типам задач
  (выявляет паттерны: "epic-level задачи у нас в среднем 2 недели в foggy -- ок или нет?")
- [ ] Sprint health score trending: risk_score + velocity + utilization = composite health
- [ ] Retrospective insights: автоматические наблюдения для retro ("3 foggy айтема
  в этом спринте потребовали 40% больше времени чем оценка -- обсудить на retro")
- [ ] Skill gap analysis: команда берёт Python-задачи, но уровень Dreyfus = Beginner
  и clarity = foggy -- система предлагает learning task или найти ментора

---

## Терминологический движок (Terminology Engine)

### Проблема

V1 (VersionOne) выиграл часть рынка именно потому, что команды могли назвать
"backlog" так, как им удобно: "issue", "user story", "ticket", "case".
Это не косметика -- это снижение порога восприятия. Разные команды, разные культуры,
разные отрасли. "Sprint" непонятен SAFe-командам, они говорят "iteration".
"Epic" у одних -- у других "initiative" или "theme".

Более мощная версия той же идеи: сменить весь UI на другой язык, добавив не один словарь
терминов, а полный языковой пакет. Команда из Бразилии говорит по-португальски.

### Два слоя, которые нельзя путать

Это фундаментальный архитектурный выбор: смешать их -- получить кашу.

| Слой | Что это | Примеры | Scope |
|------|---------|---------|-------|
| **Domain Vocabulary** | имена сущностей системы | "backlog" -> "issue", "sprint" -> "iteration" | instance / project |
| **UI Localization** | весь интерфейс на другом языке | "Save" -> "Сохранить", "Settings" -> "Настройки" | instance |

**Domain Vocabulary** -- это V42-специфичная фича. Небольшой набор ключевых терминов
(~30-40 штук), которые команда может переименовать. Реализуется через DB + API.

**UI Localization** -- стандартная i18n задача. Тысячи строк. Реализуется через
`i18next` + JSON locale-файлы. Трудоёмко, но предсказуемо.

### Слой 1: Domain Vocabulary (v2 target, приоритет)

#### Иерархия scope

```
Instance level (admin sets defaults)
  |
  +-- Project level (maintainer overrides per-project)
           |
           +-- [future v3] Team level override
```

Если в проекте не задано -- берётся instance default.
Если в instance не задано -- берётся system default (английский).

#### Реестр терминов (term keys)

Только то, что пользователь видит как "имя сущности". Не UI chrome.

| Key | Default singular | Default plural | Примеры переопределений |
|-----|-----------------|----------------|------------------------|
| `backlog_item` | Backlog Item | Backlog Items | Issue, Story, Ticket, Card |
| `epic` | Epic | Epics | Theme, Initiative, Program, Feature Set |
| `sprint` | Sprint | Sprints | Iteration, Cycle, Period, Wave |
| `task` | Task | Tasks | Sub-task, Activity, Work Item, Action |
| `test` | Test | Tests | Check, Scenario, Verification, Case |
| `release` | Release | Releases | Version, Milestone, Deployment |
| `stage` | Stage | Stages | Phase, Milestone, Wave, Gate |
| `goal` | Goal | Goals | Objective, Outcome, Initiative, OKR |
| `team` | Team | Teams | Squad, Pod, Crew, Group |
| `project` | Project | Projects | Program, Product, Initiative |
| `estimate` | Estimate | -- | Complexity, Points, Effort, Size |
| `clarity` | Clarity | -- | Risk Level, Confidence, Understanding |
| `assignee` | Assignee | Assignees | Owner, Responsible, Lead |
| `capacity` | Capacity | -- | Availability, Budget (hours) |
| `skill` | Skill | Skills | Competency, Expertise, Discipline |
| `backlog` | Backlog | -- | Queue, Board, Issue List |
| `story_point` | Story Point | Story Points | Point, SP, Complexity Unit |
| `definition_of_done` | Definition of Done | -- | Acceptance Criteria, Exit Criteria |
| `grooming` | Grooming | -- | Refinement, Backlog Review |
| `retrospective` | Retrospective | -- | Retro, Review, Post-mortem |

Итого: ~20 ключевых + до 20 дополнительных по мере роста UI. Управляемо.

#### Схема данных

```sql
-- Migration 000011
-- Stores term overrides at instance or project level.
-- scope: 'instance' (scope_id IS NULL) or 'project' (scope_id = project.id)
CREATE TABLE term_overrides (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scope      TEXT NOT NULL DEFAULT 'instance' CHECK (scope IN ('instance', 'project')),
    scope_id   UUID,                 -- NULL = instance; project_id = project scope
    term_key   TEXT NOT NULL,        -- from the registry above (backlog_item, sprint, ...)
    singular   TEXT NOT NULL,        -- "Issue"
    plural     TEXT NOT NULL,        -- "Issues"
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (scope, scope_id, term_key),
    CONSTRAINT scope_id_required_for_project CHECK (
        (scope = 'instance' AND scope_id IS NULL) OR
        (scope = 'project'  AND scope_id IS NOT NULL)
    )
);
CREATE INDEX idx_term_overrides_scope ON term_overrides(scope, scope_id);
```

#### Export / Import формат (JSON)

```json
{
  "v42_terminology": "1.0",
  "scope": "project",
  "scope_name": "Acme Corp - Mobile App",
  "exported_at": "2026-05-23T12:00:00Z",
  "terms": {
    "backlog_item": { "singular": "Issue",     "plural": "Issues" },
    "sprint":       { "singular": "Iteration", "plural": "Iterations" },
    "epic":         { "singular": "Theme",     "plural": "Themes" },
    "task":         { "singular": "Sub-task",  "plural": "Sub-tasks" }
  }
}
```

Пустой объект `terms` означает "сброс к defaults".
Частичный импорт: указываем только то, что хотим переопределить.
Остальное берётся по иерархии scope (project -> instance -> system default).

#### API

```
-- Instance-level (admin only)
GET    /api/v1/terminology                     -- все term_overrides для instance
PUT    /api/v1/terminology/{key}               -- { singular, plural }
DELETE /api/v1/terminology/{key}               -- сброс к system default
GET    /api/v1/terminology/export              -- JSON файл (весь instance словарь)
POST   /api/v1/terminology/import              -- загрузить JSON, применить к instance

-- Project-level (maintainer+)
GET    /api/v1/projects/{id}/terminology       -- merged view: project overrides + instance defaults
PUT    /api/v1/projects/{id}/terminology/{key} -- { singular, plural }
DELETE /api/v1/projects/{id}/terminology/{key} -- сброс к instance default
GET    /api/v1/projects/{id}/terminology/export
POST   /api/v1/projects/{id}/terminology/import

-- System defaults (read-only, для справки)
GET    /api/v1/terminology/defaults            -- полный реестр ключей с system defaults
```

#### Frontend: TerminologyContext

```tsx
// Загружается один раз при заходе в проект (или на инстанс уровне при логине)
// GET /projects/{id}/terminology -> merged dictionary

const useT = () => {
  const terms = useTerminologyStore();
  return (key: TermKey, count?: number): string => {
    const override = terms[key];
    if (!override) return systemDefaults[key][count === 1 ? 'singular' : 'plural'];
    return count === 1 ? override.singular : override.plural;
  };
};

// Usage в любом компоненте:
const t = useT();
<h1>{t('backlog_item', items.length)}</h1>  // "Issues" or "Issue"
<label>{t('sprint')}</label>                 // "Iteration"
```

Zustand store `useTerminologyStore` загружается после логина (instance terms)
и при открытии проекта (project override merge). Никаких extra запросов
при рендере -- всё кешировано.

#### Скилы -- особый случай

`skills.name` -- это данные в БД, не UI-строки. "TypeScript", "Python", "Go" --
proper nouns, перевод не нужен. Кастомные скилы (созданные инстансом) именуются
сразу на нужном языке.

**Исключение**: если instance настроен на русский язык, admin может создать скилы
с русскими именами сразу. Отдельный механизм перевода скил-каталога не нужен на v2.
На v3, если понадобится: добавить `skills.name_overrides JSONB` -- `{"ru": "ТайпСкрипт"}`.

---

### Слой 2: Полная UI-локализация (v3, крупная задача)

Стандартный `i18next` с namespace-структурой.

#### Архитектура

```
frontend/src/i18n/
  locales/
    en/
      common.json     -- Save, Cancel, Delete, Confirm, ...
      auth.json       -- Login, Logout, Password, ...
      backlog.json    -- все строки BacklogPage
      sprint.json     -- SprintPage strings
      ...
    ru/
      common.json
      ...
    pt/
      ...
  i18n.ts             -- i18next init, language detection
```

Ключи в коде: `t('backlog:add_item_placeholder')` вместо `"Search backlog..."`.

#### Два источника строк

| Тип | Механизм | Пример |
|----|----------|--------|
| Domain terms | TerminologyContext (`useT`) | `t('backlog_item', 2)` -> "Issues" |
| UI chrome | i18next (`useTranslation`) | `t('backlog:filter_placeholder')` -> "Search..." |

Domain terms и i18n -- независимые слои. Term overrides работают поверх i18n:
даже если UI переведён на русский, `t('backlog_item', 2)` вернёт кастомный
термин этого проекта (например "Задачи" вместо "Истории").

#### Объём работы (оценка)

| Этап | Что | Строк кода / дней |
|------|-----|-------------------|
| Аудит строк | найти все hardcoded strings в компонентах | 1-2 дня |
| Вынос в en/ JSON | replace strings с t() calls | 8-12 дней |
| Второй язык (ru) | перевод + тест | 3-5 дней |
| Admin UI для локалей | upload/download locale, switch | 2-3 дня |
| QA полный проход | edge cases (длинные строки, RTL?) | 2-3 дня |
| **ИТОГО** | | **~16-25 дней** |

Это не делается за один присест. Правильный подход: компонент за компонентом,
по мере касания файла при других задачах.

#### Риски

- **Строки в тостах, ошибках, alert'ах**: разбросаны по всему коду -- тяжело найти
- **Динамические строки**: `"${count} items selected"` -- нужен pluralization (i18next это умеет)
- **Длинные переводы ломают layout**: немецкий может быть на 30% длиннее английского
- **Даты и числа**: нужен `Intl.NumberFormat` + `Intl.DateTimeFormat` -- не только строки

---

### Оценка сложности

| Компонент | Сложность | Дней | Приоритет |
|-----------|-----------|------|-----------|
| Domain Vocabulary (DB + API) | Низкая | 2-3 | v2 |
| TerminologyContext (frontend) | Средняя | 2-3 | v2 |
| Export / Import UI (admin page) | Низкая | 1-2 | v2 |
| **Итого Domain Vocabulary** | | **5-8** | **v2** |
| i18n аудит + вынос строк | Высокая | 8-12 | v3 |
| Второй язык + QA | Средняя | 5-8 | v3 |
| Admin locale UI | Средняя | 2-3 | v3 |
| **Итого полная i18n** | | **15-23** | **v3** |

---

### Фаза 11 -- Domain Vocabulary Engine (5-8 дней, v2)

#### 11a -- Backend (2-3 дня)
- [ ] Миграция 000011: `term_overrides` таблица
- [ ] sqlc queries: `UpsertTermOverride`, `DeleteTermOverride`, `ListTermOverrides(scope, scope_id)`,
  `GetMergedTerminology(project_id)` -- JOIN instance + project с project priority
- [ ] API endpoints: instance CRUD (admin), project CRUD (maintainer), defaults read
- [ ] Export endpoint: `GET /terminology/export` -> JSON response с `Content-Disposition: attachment`
- [ ] Import endpoint: `POST /terminology/import` -> parse JSON, validate keys против реестра,
  reject unknown keys (безопасность: никаких инъекций через arbitrary keys)
- [ ] Integration tests: scope hierarchy merge, partial import, unknown key rejection

#### 11b -- Frontend (2-3 дня)
- [ ] `useTerminologyStore` (Zustand): `terms: Record<TermKey, {singular, plural}>`, `loadTerms(projectId)`
- [ ] `TerminologyProvider` -- загружает при открытии проекта, мержит с instance defaults
- [ ] `useT()` hook -- `(key: TermKey, count?: number) => string`
- [ ] Заменить hardcoded entity names во всех компонентах на `useT()` (scope: ~20 мест)
  -- НЕ всё, только названия сущностей: заголовки страниц, column headers, пустые state тексты
- [ ] Кешировать в `localStorage` под ключом `v42-terms:{projectId}` -- мгновенный cold start

#### 11c -- Admin UI (1-2 дня)
- [ ] `TerminologyPage` (`/admin/terminology`): таблица ключей, текущие значения,
  inline edit, сброс к default по кнопке
- [ ] `ProjectSettingsPage` (`/projects/{id}/settings`): раздел Terminology с тем же UI
- [ ] Export кнопка -> скачивает JSON файл
- [ ] Import: drag-and-drop JSON, preview изменений, confirm

---

### Фаза 12 -- Full UI Localization (v3, future)

- [ ] Выбор: `i18next` + `react-i18next` (стандарт, зрелый)
- [ ] Аудит: найти все hardcoded strings (eslint-plugin-i18next помогает)
- [ ] Namespace структура: `common`, `auth`, `backlog`, `sprint`, `team`, `admin`
- [ ] Первый язык: English (уже есть -- просто вынести в JSON)
- [ ] Второй язык: Russian (или тот, который запросит первый клиент)
- [ ] Дата/число форматирование: `Intl` API -- не строки, а форматтеры
- [ ] Language switcher в `/profile` (dropdown, флаг + название)
- [ ] Locale persistence: `users.locale TEXT DEFAULT 'en'` -- сохранять на сервере
- [ ] Community translations: GitHub-based contribution workflow (как Crowdin без Crowdin)

---

## Правила разработки

1. **Миграции -- только вперёд.** Никогда не редактируем существующую миграцию.
   Сломали -- пишем новую миграцию которая исправляет.

2. **sqlc -- источник истины для типов БД.** Не пишем SQL в Go-коде вручную.
   Всё -- через `.sql` файлы в `db/queries/`, потом `make sqlc`.

3. **Domain logic -- без HTTP и без SQL.** `internal/domain/` не импортирует
   `net/http` и не знает про sqlc. Это позволяет тестировать бизнес-логику без БД.

3a. **Видимость проектов (v2 -- multi-team).** Пользователь видит проект если состоит
    в ЛЮБОЙ из команд проекта (`team_members` -> `project_teams` -> `projects`).
    Проекты без команд видят только admin и maintainer.
    SQL-паттерн для middleware:
    ```sql
    EXISTS (
        SELECT 1 FROM project_teams pt
        JOIN team_members tm ON tm.team_id = pt.team_id
        WHERE pt.project_id = $project_id AND tm.user_id = $current_user_id
    )
    ```
    Правило в middleware, не в каждом handler отдельно.
    Миграция с v1 (`projects.team_id`) -- см. миграцию 000009.

4. **API тесты с первого дня.** Каждый новый endpoint -- минимум один интеграционный тест
   с реальной тестовой БД. Это не обсуждается -- ради этого и строим V.42.

5. **Один `.env.example`.** Все конфиг-параметры задокументированы там.
   Никаких магических дефолтов в коде -- всё явно.

7. **Backlog item = цель + тест.** `ac_steps` и `ac_expected` -- не документация, а определение
   "готово". Переход в статус `done` требует `sprint_test_results.status = pass`.
   Это не опция -- это архитектурный принцип. Реализуется в `domain/backlog.go`.

8. **Clarity_level = обязательное поле с первого дня данных.** Новый беклог-айтем всегда
   начинает как `unknown`. Переход в спринт без `clear` или `scoped` -- warning,
   но не hard block. Система подсвечивает, команда решает. Данные накапливаются.

9. **Fog-change события через SSE.** Каждое изменение `clarity_level` -- это событие
   которое broadcaster публикует в проектный SSE поток. Клиент обновляет risk score
   без reload. Это не nice-to-have -- это корень real-time аналитики.

6. **Semantic versioning API.** Сломать публичный контракт = новая `/api/v2/`.

---

## Переменные окружения (.env.example)

```bash
# Server
SERVER_PORT=8080
SERVER_HOST=0.0.0.0

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=v42
DB_USER=v42
DB_PASSWORD=changeme
DB_SSL_MODE=disable

# Auth
JWT_SECRET=change-this-to-a-long-random-secret-in-production
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d

# App
APP_ENV=development          # development | production
LOG_LEVEL=info               # debug | info | warn | error
SEED_ADMIN_EMAIL=admin@v42.local
SEED_ADMIN_PASSWORD=changeme
```

---

## docker-compose.yml (базовый)

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB:       ${DB_NAME}
      POSTGRES_USER:     ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 5s
      timeout: 5s
      retries: 5

  adminer:
    image: adminer:latest
    ports:
      - "8081:8080"
    depends_on:
      - postgres

  api:
    build: .
    depends_on:
      postgres:
        condition: service_healthy
    env_file: .env
    ports:
      - "${SERVER_PORT}:${SERVER_PORT}"

volumes:
  postgres_data:
```

---

## Бить? Или не бить?

Интересное наблюдение культурных особенностей. Для одних "дорого-богато", для других "практично-лаконично" и так далее. На всех не угодишь. Или всё таки есть шанс? Ведь может же дерево смотреться богато, а золото убого. Так? Вот мне любопытно. Наши пузыри кому зайдут? Вопрос чисто филосовский, но далеко не праздный.

По поводу братьев Дрейфус и их модели. Средне статистически переход на каждый следующий уровень требует экспоненциально больше затрат. Например, с начинающего до новичка это месяц-два. До уверенного уже три-четыре месяца. Дальше полтора года до автономии, когда включаются мозги и задают вопрос "почему?". До профи три-четыре года. Мастерство 10+. И это регулярной работы и по каждому скилу отдельно... Жизнь прожить, не поле перейти. Но, после мастера -- ты снова новичок! Достигнув предела познания в отдельно взятой области ты попадаешь в трансцендентное состояние, когда ты и есть правило. Очень одинокое состояние на вершине бытия... Но в то же время, чтобы освоить что-то другое нужно спуститься в долину незнания... Уроборос. Цикл замкнут. Познание не имеет предела.

Учитывая всё это и не только, рост команды и каждого отдельного её члена -- залог успеха. Нет предела совершенству. Best practices are the past practices. На том стояли и стоять будем на славу отчизне. Без пафоса. Не подведём предков.

Можно весь этот поток сознания сбросить в IDEAS.md, как базу для калибровки точки сборки по Кастанеде. Потому, что мы в пути. Трансцендируем в грядущее. Ибо время не идёт вспять, а с дураками не спорим. Они -- присоединённая масса. Гарант стабильности. Якорь и залог, который придётся отдать однажды каждому...

> "исторический роман сочинял я по-немногу. Пробираясь сквозь туман от пролога к эпилогу"
> "как он дышит, так и пишет"
>
> -- Булат Окуджава

---

## Backlog Power Features (VersionOne-style)

Три возможности из V1, которые сделали работу с бэклогом реальной, а не декоративной.
Реализованы как расширение Фазы 4, не ломая ни одного существующего контракта.

---

### 1. Inline expand: задачи и тесты прямо в строке бэклога

**Зачем:** видеть состав item-а без перехода на страницу деталей. Всё как на ладони,
прямо в таблице -- как в V1 "Add Task" / "Expand Tests" в сетке бэклога.

**UX:**
- В крайней левой колонке каждой строки -- кнопка `[+]` / `[-]`
- По клику раскрывается панель под строкой item-а (не сбоку, а именно под)
- Внутри: две секции -- Tasks и Tests. Кол-во в заголовке (Tasks: 3 / Tests: 2)
- Каждая задача в одну строку: статус-пилюля | название | оценка | кнопка Move
- Каждый тест: тип-бэдж | название | кнопка Move
- Данные загружаются лениво (on demand) при первом раскрытии; кэш TanStack Query
- State: `expandedItems: Set<string>` в компоненте BacklogPage (не в zustand -- локальный UI state)

**Данные:**
- `GET /projects/:pid/backlog/:itemId/tasks` -- уже есть
- `GET /projects/:pid/backlog/:itemId/tests` -- уже есть
- Хуки `useTasks` и `useItemTests` из `useItemDetails.ts` -- уже есть

**Изменения:**
- `BacklogPage.tsx`: добавить колонку expand, компонент `ExpandedItemPanel`
- `useItemDetails.ts`: без изменений (хуки уже готовы)
- Backend: без изменений

---

### 2. Move task / Move test между backlog items

**Зачем:** реалокация работы -- самая частая операция на грумингах. "Эта задача
теперь относится к той фиче" -- одно движение, а не удали / пересоздай.

**UX:**
- Кнопка "Move" в строке каждой задачи / теста внутри expanded panel
- Открывает inline-dropdown со списком всех backlog items проекта (кроме текущего)
- Item picker: searchable, показывает `#номер Название`
- После выбора: оптимистичный UI (задача исчезает из текущего item-а), подтверждение
  через инвалидацию кэша обоих item-ов

**Данные:**
- Новый endpoint: `POST /projects/:pid/backlog/:itemId/tasks/:taskId/move`
  Body: `{ "target_item_id": "uuid" }`
  Ответ: перемещённая задача с новым `backlog_item_id`
- Аналогично: `POST /projects/:pid/backlog/:itemId/tests/:testId/move`
  Body: `{ "target_item_id": "uuid" }`

**Реализация (Go):**
- SQL: `UPDATE tasks SET backlog_item_id = $2, updated_at = now() WHERE id = $1 RETURNING ...`
- SQL для тестов аналогично
- Store: `TaskStore.MoveTo(ctx, taskID, newItemID)`, `TestStore.MoveTo(...)`
- Handler: валидирует что task принадлежит текущему item (защита), выполняет move
- Router: `POST /backlog/{backlog_item_id}/tasks/{id}/move` (without RequireRole -- любой участник)
- Аналогично для tests

**Инвалидация кэша (frontend):**
```typescript
// onSuccess:
qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, oldItemId) });
qc.invalidateQueries({ queryKey: taskKeys.byItem(projectId, targetItemId) });
```

---

### 3. Backlog breakdown: разбить один item на несколько

**Зачем:** классическая ситуация грумминга -- "эта история слишком большая, давайте
разобьём на три". В V1 это был отдельный экран с drag-and-drop распределением задач.

**UX:**
- Кнопка "Break down" в expanded panel или в контекстном меню строки бэклога
- Открывается модал на весь экран:
  - Слева: исходный item (заголовок, задачи, тесты) -- readonly
  - Справа: 2+ новых item-а (можно добавлять/удалять)
    - Каждый: поле Title + Estimate (SP)
    - Drag zone: перетащи задачи/тесты в этот item
  - Задачи/тесты, не назначенные ни в один новый item, остаются в оригинальном
    (или оригинальный item сохраняется как "remainder" с нераспределённой работой)
  - Кнопка "Execute breakdown" внизу

**Правила:**
- Минимум 2 новых item-а
- Каждый должен иметь title
- Сумма estimate-ов новых items -- рекомендательная (не обязательна совпадать с оригиналом)
- Оригинальный item **всегда сохраняется** -- история не переписывается. Он получает
  статус `decomposed`, скрывается из всех рабочих view (backlog, sprint board, фильтры),
  но хранится как корень поддерева в "Дереве жизни проекта"

**Дерево жизни (Life Tree) -- будущий экран:**
В backlog_items добавляется `parent_item_id UUID REFERENCES backlog_items(id)`.
Новые items после breakdown получают ссылку на оригинальный item.
Если новый item тоже разбивается -- он тоже становится `decomposed` и порождает своих детей.
Получается дерево, в котором видно, как понимание проекта эволюционировало:
что выросло, что завяло, что мутировало. Живая история грумминга.

Экран "History / Life Tree": интерактивная D3 или Recharts tree-диаграмма,
только read-only, без правок. Каждый узел показывает:
- заголовок item-а
- дату декомпозиции
- оценку (оригинальную vs. суммарную детей)
- статус ветки

Пример визуализации: горизонтальное дерево слева-направо, узлы кликабельны,
открывают side panel с деталями item-а.

**Данные (frontend-driven batch):**
1. `POST /projects/:pid/backlog` x N -- создать новые items (с теми же epic/release/stage)
2. `POST /projects/:pid/backlog/:oldItemId/tasks/:taskId/move` x M -- переместить задачи
3. `POST /projects/:pid/backlog/:oldItemId/tests/:testId/move` x K -- переместить тесты
4. Опционально: `DELETE /projects/:pid/backlog/:oldItemId` или `PATCH` status=cancelled

Batch выполняется последовательно с rollback по ошибке (delete новых items если шаг 2/3 упал).

**Специального backend endpoint не нужно** -- orchestration на frontend через
существующие примитивы. Атомарность не критична для грумминга (не транзакционная операция).

**Статус:** дизайн готов. Реализация -- следующий приоритет после move (зависит от него).
UI: модал с dnd-kit DragOverlay (уже в стеке), три drop zone-ы для новых item-ов.

---

## Иерархия проектов и этапов (Project Node Tree)

> "Проект - дело не одного дня и не одной команды."
> Текущая модель: плоский список проектов. Реальность: сложные программы с вложенными
> этапами, несколькими командами на разных уровнях, долгой историей.
> Пора это исправить.

---

### Концепция: Project == Milestone

Ключевой инсайт из TODO.md: **"Собственно проект и этап это суть одно и то же.
Разные названия -- для удобства."**

Это не метафора. Это буквально одна таблица с `parent_id`. Корневые узлы
называются "проект" в UI. Дочерние -- "этап". Это чисто косметическое отличие.

```
R-10011  MyProduct            (root = Project)
  R-10042  Backend MVP        (child = Milestone)
    R-10063  Auth subsystem   (grandchild = sub-Milestone)
    R-10077  API v1
  R-10055  Frontend Phase 1
  R-10089  QA & Hardening
```

Дерево не ограничено по глубине. Каждый узел может иметь:
- дату начала и окончания (основа для будущего Gantt)
- команды (унаследованные с верхних уровней + собственные)
- требования к скилам (минимальный уровень + количество)
- баклог (бэклог принадлежит узлу, а не только корневому проекту)

---

### Модель данных: что меняется

#### Таблица `projects` становится деревом

```sql
-- Добавляем к существующей таблице:
ALTER TABLE projects ADD COLUMN parent_id UUID REFERENCES projects(id) ON DELETE RESTRICT;
ALTER TABLE projects ADD COLUMN start_date DATE;
ALTER TABLE projects ADD COLUMN end_date   DATE;
-- Sequential human-readable ID (R-XXXXX), global counter:
ALTER TABLE projects ADD COLUMN node_number BIGINT UNIQUE;  -- R-10011 format

-- Индексы:
CREATE INDEX idx_projects_parent ON projects(parent_id) WHERE parent_id IS NOT NULL;
```

`ON DELETE RESTRICT` на `parent_id` -- нельзя удалить узел, у которого есть дети.
Сначала удали детей (или перемести). Это принципиально: дерево не разрывается тихо.

Корневой узел: `parent_id IS NULL`. Ограничение `project_status` сохраняется на всех уровнях.

#### Числовой ID для проектов/этапов: R-XXXXX

По аналогии с миграцией 11 (E-N для эпиков, B-N для баклога).
Разница: `node_number` -- **глобальный** счётчик (не per-project). Причина: этапы могут
переезжать между проектами (DnD в дереве). Глобальный ID не конфликтует при переносе.

```sql
-- Глобальная последовательность:
CREATE SEQUENCE project_node_seq START 10001 INCREMENT 1;

-- Триггер:
CREATE OR REPLACE FUNCTION _assign_project_node_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.node_number IS NULL THEN
    NEW.node_number := nextval('project_node_seq');
  END IF;
  RETURN NEW;
END;
$$;

-- Отображение в API: 'R-' || node_number  (форматирование на уровне запроса или frontend)
```

Старт с 10001 -- чтобы R-10011 выглядел солиднее чем R-1. Маркетинговый момент.

#### Числовой ID для спринтов: I-XXXXX

```sql
ALTER TABLE sprints ADD COLUMN sprint_number BIGINT UNIQUE;
CREATE SEQUENCE sprint_seq START 101 INCREMENT 1;
-- Триггер аналогичен project_node_seq.
-- Формат: 'I-' || sprint_number
```

---

### Глобальная схема ID для всех сущностей

Принцип: **глобальный ID обязателен для ВСЕХ элементов базы**. Нет per-project
счётчиков. Нет конфликтов нигде. Один тип ID из любого контекста однозначно
идентифицирует запись без указания проекта.

Дополнительный бонус: все ID примерно одинаковой длины -- нет разнобоя `B-1` vs
`B-982342`. Стартовые значения подобраны под "солидный" внешний вид.

| Сущность | Префикс | Последовательность | Старт | Пример |
|---|---|---|---|---|
| Project node (проект/этап) | `R-` | `project_node_seq` | 10001 | `R-10042` |
| Sprint | `I-` | `sprint_seq` | 288 | `I-301` |
| Epic | `E-` | `epic_seq` | 1001 | `E-1047` |
| Backlog item | `B-` | `backlog_seq` | 5001 | `B-5138` |
| Task | `Z-` | `task_seq` | 10001 | `Z-10077` |
| Test | `T-` | `test_seq` | 3001 | `T-3948` |
| Milestone marker | `M-` | `milestone_seq` | 101 | `M-115` |

**Миграция**: текущие `epics.number` и `backlog_items.number` -- per-project счётчики
(миграция 11). Нужно заменить на глобальные последовательности. Подход:
- `ALTER SEQUENCE` нельзя (счётчики триггерные, не sequence). Нужна новая миграция:
  1. Создать глобальные `CREATE SEQUENCE epic_seq`, `backlog_seq`, `task_seq`, `test_seq`
  2. Добавить новые колонки: `epics.seq_number`, `backlog_items.seq_number`, `tasks.seq_number`, `tests.seq_number`
  3. Backfill через `nextval` в UPDATE
  4. Старые per-project `.number` оставить как-есть (backward compat) или deprecate
- Внешний формат: `'E-' || seq_number` -- формируется в sqlc query или Go handler,
  не хранится в БД. Хранится только `BIGINT`. Это принципиально: приставку можно
  сменить без миграции данных.

#### Требования к скилам на уровне узла

Новая таблица -- скилсет-профиль этапа:

```sql
CREATE TABLE node_skill_requirements (
    node_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    skill_id      UUID NOT NULL REFERENCES skills(id)   ON DELETE CASCADE,
    min_level     skill_level NOT NULL DEFAULT 'competent',
    headcount     SMALLINT NOT NULL DEFAULT 1,  -- сколько человек с таким уровнем нужно
    notes         TEXT,                          -- "предпочтительно embedded Linux + RTOS"
    PRIMARY KEY (node_id, skill_id)
);
CREATE INDEX idx_node_skill_req ON node_skill_requirements(node_id);
```

Это позволяет: "для этапа Backend MVP нужны 2 Go-разраба уровня proficient и 1 tester".

#### Команды на уровне узла

Текущая `project_teams` уже отражает привязку команд к проекту (root).
Добавляем поддержку произвольного узла -- переименовываем смысловой контекст:

```sql
-- project_teams уже имеет (project_id, team_id).
-- project_id здесь -- это ID любого узла дерева, не обязательно корневого.
-- Колонку переименовывать не нужно: project_id в таблице хранит UUID узла.
-- Семантика расширяется: "team attached to THIS node (and visible to all descendants)".
-- Нужен только индекс и документация. Схема уже правильная.
```

Никаких ALTER TABLE -- концептуальное расширение. Документируем в sqlc-комментарии.

#### Milestone маркер: «тег в гите» для временной привязки

Концепция уточнена: **milestone** -- это НЕ узел дерева (Этап). Это временной маркер:
именованная точка во времени с датой и описанием. Как `git tag`. Как milestone в MS Project.

Ключевое свойство: **несколько узлов дерева (Этапов) могут ссылаться на один Milestone**.
Пример: "Release 2.0 GA" -- это milestone на дату. К нему привязаны:
- Этап "Backend API freeze"
- Этап "Frontend feature complete"
- Этап "QA sign-off"
Все три должны завершиться к этой дате. Milestone -- точка контроля и планирования буфера.

```sql
CREATE TABLE milestones (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,       -- "Release 2.0 GA", "MVP Demo Day"
    description TEXT,
    target_date DATE NOT NULL,       -- дедлайн
    seq_number  BIGINT UNIQUE,       -- M-115 формат
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_milestones_project ON milestones(project_id);
CREATE SEQUENCE milestone_seq START 101 INCREMENT 1;
```

#### Баклог: привязка к узлу дерева и к milestone маркеру

Текущая схема: `backlog_items` имеет `project_id`, `stage_id`, `release_id`.

В новой модели три независимых измерения на backlog item:
- `project_id` -- **корневой проект** (не меняется, для permissions и индексации)
- `stage_id` → **заменяется на `node_id` (UUID → projects(id))**:  привязка к узлу
  дерева (какой Этап ведёт эту работу)
- `milestone_id` → **новый FK → milestones(id)**: к какой контрольной точке целимся

Мигрировать сразу не нужно: добавить `node_id` и `milestone_id` как nullable,
старые `stage_id`/`release_id` не трогать. Данные переносятся через UI позже.

```sql
ALTER TABLE backlog_items
  ADD COLUMN node_id      UUID REFERENCES projects(id)  ON DELETE SET NULL,
  ADD COLUMN milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
```

Правило `releases`: остаются как "shipping event" (момент выкатки на прод). Это
другой ракурс от milestone маркера: release = "что выходит", milestone = "когда и к
чему готовимся". Оба измерения полезны, не смешиваем.

---

### Видимость и авторизация через поддерево

Политика видимости:
```
user видит узел N <=>
  role == admin  (видит всё, без проверок)  OR
  user в команде, привязанной к N  OR
  user в команде, привязанной к parent(N)  OR
  ...  (рекурсивно до корня)
```

Админ видит всё. Это не исключение из правил -- это отдельная ветка в middleware,
которая не делает лишних SQL запросов. Один `if user.Role == admin { return true }`.

Для всех остальных -- рекурсивный CTE по предкам:

```sql
WITH RECURSIVE ancestors AS (
  SELECT id, parent_id FROM projects WHERE id = $node_id
  UNION ALL
  SELECT p.id, p.parent_id
  FROM projects p INNER JOIN ancestors a ON p.id = a.parent_id
)
SELECT EXISTS (
  SELECT 1
  FROM project_teams pt
  JOIN team_members tm ON tm.team_id = pt.team_id
  WHERE pt.project_id IN (SELECT id FROM ancestors)
    AND tm.user_id = $user_id
);
```

Middleware в Go: `canAccessNode(ctx, userID, nodeID)` с кешем на уровне запроса.
Для admin-роли -- ранний возврат `true` без SQL.

#### Закрытые узлы: скрыть по умолчанию

Этапы со статусом `completed` или `cancelled` **не показываются** в дереве проектов
и в фильтрах баклога по умолчанию. Это касается всех сущностей:
- Закрытые Этапы (completed/cancelled) -- скрыты
- Закрытые Спринты -- скрыты
- Закрытые Баклог-айтемы -- скрыты (уже спроектировано ранее)

API: параметр `?show_closed=true` на соответствующих эндпоинтах.
Frontend: чекбокс "Показать закрытые" на странице проектов и в фильтрах баклога.
По умолчанию -- `false`. Состояние сохраняется в localStorage.

---

### Зависимости: что тянется за изменением

Это масштабное изменение. Вот полный список затронутых компонентов:

#### База данных
| Что меняется | Сложность | Примечание |
|---|---|---|
| `projects`: добавить `parent_id`, `start_date`, `end_date`, `node_number` | Низкая | ALTER TABLE + триггер |
| Глобальная последовательность `project_node_seq` | Низкая | CREATE SEQUENCE + триггер |
| Глобальная последовательность `sprint_seq` | Низкая | аналогично |
| Новая таблица `node_skill_requirements` | Низкая | CREATE TABLE |
| `backlog_items`: добавить `milestone_id` | Низкая | ALTER TABLE (nullable) |
| `project_teams`: переосмыслить (без ALTER) | Нет | только документация |
| `stages` → deprecation (позже) | Высокая | нужна миграция данных, не сейчас |
| `releases` → переосмыслить роль | Средняя | остаётся как "shipping event", не контейнер |

#### Backend (Go)
| Компонент | Что меняется |
|---|---|
| `projects.go` handler | CRUD для дерева: create с `parent_id`, tree query (рекурсивный CTE) |
| Auth middleware | `canAccessNode()` через рекурсивный CTE, кеш на запрос |
| `sprints.go` | добавить `sprint_number` в ответы, `I-XXX` формат |
| `backlog.go` | поддержка `milestone_id` в фильтрах и создании |
| sqlc queries | новые запросы: tree traversal, subtree backlog, node teams |
| API routes | `/projects/:pid/children`, `/projects/:pid/tree`, `/nodes/:nid/...` |

#### Frontend
| Компонент | Что меняется |
|---|---|
| `ProjectsPage` | полная переработка: плоская таблица → дерево с +/- |
| Sidebar navigation | выбор проекта с деревом (возможно mini-tree или breadcrumb) |
| Backlog page | фильтр по milestone_id (узел дерева), не только stage |
| Sprint display | показывать `I-XXX` в заголовках спринтов |
| Project cards/rows | показывать `R-XXXXX`, дату начала/конца |
| New project form | добавить `parent_id` выбор (создать как подузел) |

#### Что НЕ меняется
- JWT и auth flow
- Структура баклог-айтемов, задач, тестов
- Спринты (только добавляется `sprint_number`)
- Эпики (независимое измерение, не входят в дерево узлов)
- Teams и member_skills

---

### Страница проектов: новый UX

Таблица-дерево с:
- Колонки: `[+/-]` `R-XXXXX` `Name` `Status` `Start` `End` `Teams` `Progress`
- `[+/-]` -- expand/collapse. Узлы без детей не имеют этой кнопки
- Добавить дочерний этап: кнопка `+` в строке, создаёт дочерний узел
- Добавить корневой проект: кнопка вверху списка
- Инлайн редактирование: двойной клик на Name, Start, End -- редактирование на месте
- DnD: переместить строку -- меняет `parent_id` и `order_index`
  - DnD в рамках одного родителя = реорядочивание
  - DnD в другой родитель = перенос этапа
- Скил-карта: иконка или кнопка в строке открывает side panel с требованиями
- Клик на название -- переход к деталям узла (баклог, команды, спринты)

DnD ограничения:
- Нельзя перенести узел в его собственное поддерево (цикл в дереве)
- При переносе этапа: `project_id` в `backlog_items` НЕ меняется (items всегда
  принадлежат корневому проекту). Меняется только `milestone_id`.
- Ограничение глубины: опционально конфигурируемое (по умолчанию без ограничений)

---

### Что ещё подтянуть: анализ экосистемы (решения)

#### 1. Поиск и фильтры по видимому дереву

Поиск работает только в пределах ВИДИМЫХ пользователю узлов. Нельзя найти то,
к чему нет доступа. Глобальный поиск (для admin) -- отдельный эндпоинт.

Реализация: PostgreSQL `tsvector` на `projects.name || ' ' || COALESCE(projects.description, '')`.
Индекс: `CREATE INDEX idx_projects_fts ON projects USING gin(to_tsvector('english', name || ' ' || COALESCE(description, '')))`.
API: `GET /projects?q=auth&show_closed=false` -- поиск по видимому поддереву.

Фильтры в дереве:
- По статусу (active/on_hold/archived/completed)
- По команде
- По скилу (есть ли требования к конкретному скилу)
- По периоду (start_date/end_date пересекается с заданным диапазоном)
- `show_closed=false` -- по умолчанию, скрывает completed/cancelled

#### 2. Нормализация capacity по узлу

**Обязательно.** Балансировка нагрузки -- залог предсказуемости результатов.

Формула capacity узла N:
```
capacity(N, period) = SUM(tm.capacity_hours * sprint_weeks)
  по всем team_members tm
  где team привязана к N или к любому предку N
  с учётом пересечения period и sprint dates
```

Это computed query, не хранимое значение. Вызывается при открытии узла или спринта.
Для plan vs actual: `actual = SUM(time_entries.hours)` за тот же период.
Результат: загруженность в %, отклонение от плана. Нормализуется по скилам если нужно.

#### 3. Rollup статистики вверх по дереву

**Решение: хранить в БД, обновлять в фоне через dirty-flag.**

Механика dirty-flag:
- Таблица `node_stats_cache` (или колонки прямо на `projects`):
  `open_items INT, total_items INT, clarity_score NUMERIC(4,2), stats_dirty BOOL, stats_updated_at TIMESTAMPTZ`
- При любом изменении баклог-айтема, задачи, теста в поддереве:
  установить `stats_dirty = true` на текущем узле И на всех предках (один UPDATE с CTE)
- Фоновый Go worker (тикер, раз в 30 секунд): находит все `WHERE stats_dirty = true`,
  пересчитывает рекурсивным CTE, сбрасывает флаг
- API отдаёт данные из кеша с меткой `stats_updated_at`. Клиент знает, насколько свежо.

Глобальная статистика (квартальные отчёты): отдельный эндпоинт, явный пересчёт
без кеша. Там можно "пошуршать по базе" -- это ок, раз в квартал терпимо.

#### 4. Видимость: направление транзитивности

Видимость **сверху вниз**: видишь узел -- видишь все его дочерние узлы.
Видимость **не снизу вверх**: видишь дочерний этап -- НЕ видишь автоматически
соседние ветки или родителей выше своего уровня доступа.

Админ видит всё. Нет исключений. Без рекурсивного CTE -- ранний return в middleware.

#### 5. История перемещений: где хранить?

**Решение: PostgreSQL, через существующий `activity_log` + `outbox` паттерн.**

Аргументы за PostgreSQL:
- Нет дополнительной инфраструктуры (Elasticsearch, ClickHouse -- это другой проект)
- `activity_log` уже есть в схеме
- SQL-запросы по истории работают нативно
- При необходимости -- stream через `outbox` (тоже уже есть в схеме) в любой внешний сервис

Когда нужен внешний log-сервер: при > 100 событий в секунду или требовании real-time
alerting по аномалиям. Для V42 на текущем этапе -- преждевременная сложность.

Архитектура: событие `node.moved` пишется синхронно в `activity_log` И в `outbox`.
`outbox` -- буфер для будущего relay worker-а в Kafka/webhook/etc. Сейчас outbox
просто заполняется, relay не реализован. Когда понадобится -- добавим worker.

#### 6. order_index: везде, с первого дня

DnD-сортировка -- неотъемлемая часть планирования. Без неё всегда что-то не так.
Правило: **любая упорядоченная коллекция имеет `order_index FLOAT8`**.

Статус по таблицам:
| Таблица | order_index | Примечание |
|---|---|---|
| `projects` (узлы) | нет → **добавить** | порядок в рамках одного parent_id |
| `epics` | нет → **добавить** | порядок внутри проекта |
| `backlog_items` | есть (`priority FLOAT8`) | уже правильно |
| `tasks` | есть (`order_index FLOAT8`) | уже правильно |
| `sprints` | нет → **добавить** | порядок спринтов в проекте |
| `stages` | есть | будет deprecate-нута, не трогаем |

Technique: `FLOAT8` midpoint insertion -- вставить между A и B = `(A + B) / 2`.
При исчерпании точности (числа уходят в суб-epsilon): ренумерация с шагом 1000.0.
Это редкое событие. Ренумерация -- фоновый SQL UPDATE.

#### 7. Нормализация capacity: обязательно

Подтверждено. Детали -- в пункте 2 выше. Ключевое: capacity нормализуется по скилам
если задача требует специфической компетенции. "50 часов Go-разработки" ≠ "50 часов
тестирования". Скил-специфический capacity -- следующий уровень после базового.

#### 8. Clarity Index на уровне узла (Этапа)

Синтетический индекс ясности работы по поддереву узла. Показывает, насколько понятна
работа на этом этапе в целом.

**Вариант A: Clarity Bar** (рекомендуется)

Градиентная полоса, разделённая на сегменты по уровням clarity. Ширина сегмента =
% items с данным уровнем. Границы размыты (CSS gradient, нет чёткой линии).

```
[████████████▒▒▒▒▓▓░░░░]
  clear  tacit  foggy  chaotic
  62%    21%    13%    4%
```

Вычисление (из rollup cache):
```sql
SELECT clarity, COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () AS pct
FROM backlog_items
WHERE node_id IN (SELECT id FROM subtree($node_id))
  AND status NOT IN ('done', 'cancelled')
GROUP BY clarity;
```

**Вариант B: Aggregate Score**

Число от 0 до 100: `(clear*4 + tacit*3 + foggy*2 + chaotic*1) / (count * 4) * 100`.
Проще для сортировки и сравнения узлов между собой.

**Решение: оба**. Aggregate score хранится в `node_stats_cache.clarity_score`
(обновляется dirty-flag worker-ом). Clarity Bar -- frontend-визуализация распределения.
Агрегат используется для сортировки дерева по "ясности". Bar -- для детального view узла.

Clarity Bar в UI: колонка в таблице дерева проектов (опционально скрываемая).
Цветовая схема: green (clear) → teal (tacit) → amber (foggy) → red (chaotic).
С размытыми границами через CSS `background: linear-gradient(...)`.

---

### Влияние на существующие сущности

| Сущность | Текущая привязка | После изменений |
|---|---|---|
| Backlog item | `project_id` + опц. `stage_id` | `project_id` (корень) + опц. `milestone_id` (узел) |
| Sprint | `project_id` | `project_id` (корень) -- без изменений |
| Epic | `project_id` | `project_id` (корень) -- без изменений, эпики ортогональны |
| Team | привязана к project через `project_teams` | привязана к узлу дерева (любому уровню) |
| Skill requirement | нет | новая: `node_skill_requirements` |
| Release | `project_id` | остаётся как "shipping event" (не контейнер для этапов) |

`releases` в новой модели = "момент выкатки на прод". Они не заменяют этапы дерева.
Этапы дерева = "как мы организуем работу". Релизы = "что и когда выходит наружу".
Оба измерения нужны. Не мешаем.

---

### Порядок работ (план, без кодирования пока)

**Шаг 1: Миграция схемы** (1-2 файла migrate)
- `parent_id`, `start_date`, `end_date`, `order_index`, `node_number` к `projects`
- Глобальные последовательности: `project_node_seq`, `sprint_seq`, `epic_seq`,
  `backlog_seq`, `task_seq`, `test_seq`, `milestone_seq` + триггеры
- `sprint_number` к `sprints`
- `seq_number` к `epics`, `backlog_items`, `tasks`, `tests` (глобальные, заменяют per-project)
- Таблица `node_skill_requirements`
- Таблица `milestones` (temporal markers: M-XXX)
- `node_id` и `milestone_id` к `backlog_items` (nullable, без ломки)
- `order_index` к `epics` и `sprints`
- `node_stats_cache`-колонки к `projects` (dirty-flag, rollup counters)

**Шаг 2: Backend** (Go handlers + sqlc queries)
- Рекурсивные CTE: tree traversal, subtree stats, visibility check
- `canAccessNode()` в middleware с admin fast-path
- CRUD для узлов дерева (create child, move, delete leaf + RESTRICT)
- `GET /projects` → дерево с глубиной, `?show_closed=false`
- `GET /projects/:id/tree` → полное поддерево (для sidebar)
- Фильтрация баклога по `node_id` и `milestone_id`
- `node_skill_requirements` CRUD
- `milestones` CRUD
- Фоновый worker: dirty-flag → rollup stats + clarity_score
- `activity_log` + `outbox` для node.moved событий

**Шаг 3: Frontend** (React компоненты)
- `ProjectTree` компонент: рекурсивный рендер или виртуализированный список
- Инлайн-редактирование строки (doubleclick → input)
- DnD узлов в дереве (dnd-kit): reorder + reparent с проверкой цикла
- Clarity Bar компонент (CSS gradient)
- Side panel: требования к скилам узла + capacity breakdown
- Sidebar: breadcrumb или mini-tree для навигации
- Чекбокс "Показать закрытые" на странице проектов и в фильтрах
- Глобальные ID (`R-`, `E-`, `B-`, `Z-`, `T-`, `I-`, `M-`) везде в UI

**Шаг 4: Deprecation `stages`** (последний, не торопимся)
- Миграция данных: `stages` → `projects` (как дочерние узлы)
- Перевязать `backlog_items.stage_id` → `node_id`
- Удалить таблицу `stages`

**Оценка:** Шаг 1 -- 1-2 дня (миграции + триггеры). Шаг 2 -- 3-5 дней (рекурсивный
CTE + middleware + worker). Шаг 3 -- 5-8 дней (дерево-компонент + DnD + UI). Шаг 4 --
1-2 дня (данных пока немного, рисков мало).

**Оценка сложности:** Шаг 1 -- просто. Шаг 2 -- умеренно (рекурсивный CTE + middleware).
Шаг 3 -- наибольшие усилия (дерево-компонент + DnD). Шаг 4 -- рискованный (данные).

---

## Что дальше

Фаза 0 -- фундамент. Создаём структуру, поднимаем postgres, пишем healthcheck.
Первый `make dev` который ничего не делает, но делает это стабильно и с логами.
