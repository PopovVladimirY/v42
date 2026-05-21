# V.42 -- Design Document

> "Закладываем краеугольный камень. Всё что здесь -- живёт. Всё что не здесь -- ждёт своей очереди."

---

## Стек (финальный, без пересмотра)

| Слой        | Технология                              | Почему                                      |
|-------------|------------------------------------------|---------------------------------------------|
| Backend     | Go 1.22+                                | Стабильность, один бинарник, нет node_modules |
| Router      | [chi v5](DETAILS.md#chi----http-роутер) | Минималистичный, idiomatic, без магии        |
| SQL         | [sqlc](DETAILS.md#sqlc----типизированный-sql-без-orm) + [golang-migrate](DETAILS.md#golang-migrate----миграции-схемы) | Типизированный SQL без ORM |
| Database    | [PostgreSQL 16](DETAILS.md#postgresql----база-данных) | Стандарт, надёжность, JSONB когда надо |
| Auth        | [JWT](DETAILS.md#jwt----авторизация-без-состояния) (golang-jwt/jwt/v5) | Прозрачно, без фреймворк-магии |
| Frontend    | React 19 + TypeScript + Vite            | Лучший экосистем для board UI                |
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
      handler/             -- HTTP handlers (один файл на домен)
        projects.go
        epics.go
        backlog.go
        tasks.go
        tests.go
        releases.go
        stages.go
        teams.go
        users.go
        auth.go
        stats.go
        events.go          -- SSE endpoint
      middleware/
        auth.go            -- JWT validation
        roles.go           -- role-based access
        logger.go          -- request logging
      router.go            -- chi router setup, all routes registered here
    domain/                -- pure business logic, no HTTP, no SQL
      project.go
      epic.go
      backlog.go
      team.go
      skill.go
      capacity.go          -- load planning calculations
      stats.go             -- statistics normalization
    db/
      queries/             -- .sql files (sqlc reads these)
        projects.sql
        epics.sql
        backlog.sql
        tasks.sql
        tests.sql
        releases.sql
        teams.sql
        users.sql
        skills.sql
        stats.sql
      sqlc.yaml            -- sqlc config
      db.go                -- connection setup
    config/
      config.go            -- env vars, validated at startup
    auth/
      jwt.go               -- token generation and validation
      password.go          -- bcrypt helpers
  migrations/              -- golang-migrate SQL files
    000001_init_schema.up.sql
    000001_init_schema.down.sql
    000002_skills.up.sql
    000002_skills.down.sql
  web/                     -- React app (built to web/dist/)
    src/
      api/                 -- typed API client (fetch wrappers)
      components/
      pages/
      store/               -- Zustand or similar lightweight state
    index.html
    vite.config.ts
    tsconfig.json
  docker/
    postgres/
      init.sql             -- initial DB setup (extensions etc.)
  docker-compose.yml
  docker-compose.dev.yml   -- with hot-reload volumes
  Makefile
  .env.example
  go.mod
  go.sum
```

---

## Схема базы данных

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
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, skill_id)
);

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
CREATE TYPE item_status    AS ENUM ('backlog', 'ready', 'in_progress', 'review', 'done', 'cancelled');
CREATE TYPE task_status    AS ENUM ('todo', 'in_progress', 'done', 'cancelled');
CREATE TYPE test_status    AS ENUM ('pending', 'passed', 'failed', 'skipped', 'blocked');
CREATE TYPE test_type      AS ENUM ('manual', 'acceptance', 'integration', 'unit');

CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    description TEXT,
    status      project_status NOT NULL DEFAULT 'active',
    team_id     UUID REFERENCES teams(id) ON DELETE SET NULL,
    owner_id    UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE epics (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title       TEXT NOT NULL,
    description TEXT,
    status      epic_status NOT NULL DEFAULT 'draft',
    owner_id    UUID REFERENCES users(id) ON DELETE SET NULL,
    -- epics are NOT inside releases -- they are an independent dimension
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_epics_project ON epics(project_id);

-- The heart of the system.
-- epic_id, release_id, stage_id are ALL independent nullable foreign keys.
-- A backlog item can belong to any combination: epic only, stage only, both, neither.
CREATE TABLE backlog_items (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    epic_id         UUID REFERENCES epics(id) ON DELETE SET NULL,      -- dimension 1
    release_id      UUID REFERENCES releases(id) ON DELETE SET NULL,   -- dimension 2
    stage_id        UUID REFERENCES stages(id) ON DELETE SET NULL,     -- dimension 3
    title           TEXT NOT NULL,
    description     TEXT,
    type            item_type NOT NULL DEFAULT 'story',
    status          item_status NOT NULL DEFAULT 'backlog',
    priority        SMALLINT NOT NULL DEFAULT 0,                        -- lower = higher priority
    estimate_hours  NUMERIC(5,1),
    assignee_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required  UUID REFERENCES skills(id) ON DELETE SET NULL,     -- primary skill needed
    created_by      UUID NOT NULL REFERENCES users(id),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_backlog_project   ON backlog_items(project_id);
CREATE INDEX idx_backlog_epic      ON backlog_items(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_backlog_release   ON backlog_items(release_id) WHERE release_id IS NOT NULL;
CREATE INDEX idx_backlog_stage     ON backlog_items(stage_id) WHERE stage_id IS NOT NULL;
CREATE INDEX idx_backlog_status    ON backlog_items(project_id, status);

CREATE TABLE tasks (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    backlog_item_id  UUID NOT NULL REFERENCES backlog_items(id) ON DELETE CASCADE,
    title            TEXT NOT NULL,
    description      TEXT,
    status           task_status NOT NULL DEFAULT 'todo',
    estimate_hours   NUMERIC(5,1),
    actual_hours     NUMERIC(5,1),
    assignee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    skill_required   UUID REFERENCES skills(id) ON DELETE SET NULL,
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tasks_backlog_item ON tasks(backlog_item_id);
CREATE INDEX idx_tasks_assignee     ON tasks(assignee_id) WHERE assignee_id IS NOT NULL;

-- Tests live at multiple levels -- backlog_item, epic, project.
-- Clean nullable FKs, no polymorphism needed at this scale.
CREATE TABLE tests (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    backlog_item_id  UUID REFERENCES backlog_items(id) ON DELETE CASCADE,  -- acceptance tests
    epic_id          UUID REFERENCES epics(id) ON DELETE CASCADE,           -- epic-level tests
    -- if both are null: project-level test
    title            TEXT NOT NULL,
    description      TEXT,
    steps            TEXT,                                                   -- test steps (plain text for now)
    type             test_type NOT NULL DEFAULT 'manual',
    status           test_status NOT NULL DEFAULT 'pending',
    created_by       UUID NOT NULL REFERENCES users(id),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tests_backlog_item ON tests(backlog_item_id) WHERE backlog_item_id IS NOT NULL;
CREATE INDEX idx_tests_epic         ON tests(epic_id) WHERE epic_id IS NOT NULL;
CREATE INDEX idx_tests_project      ON tests(project_id);
```

### Таймлайн

```sql
CREATE TYPE release_status AS ENUM ('planning', 'active', 'released', 'cancelled');
CREATE TYPE stage_status   AS ENUM ('pending', 'active', 'completed', 'cancelled');

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
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    release_id  UUID NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    status      stage_status NOT NULL DEFAULT 'pending',
    start_date  DATE,
    end_date    DATE,
    order_index SMALLINT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_stages_release ON stages(release_id);
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
```

---

## API -- структура эндпоинтов v1

Все эндпоинты под `/api/v1/`. Авторизация -- Bearer JWT в заголовке.
Ответ всегда в формате `{ "data": ..., "meta": ..., "error": ... }`.

```
AUTH
  POST   /api/v1/auth/login              -- { email, password } -> { token, refresh_token, user }
  POST   /api/v1/auth/refresh            -- { refresh_token } -> { token }
  POST   /api/v1/auth/logout             -- invalidate refresh token
  GET    /api/v1/auth/me                 -- current user profile

USERS  [admin only for write]
  GET    /api/v1/users                   -- list users (filterable)
  POST   /api/v1/users                   -- create user
  GET    /api/v1/users/{id}              -- get user
  PATCH  /api/v1/users/{id}             -- update user
  GET    /api/v1/users/{id}/skills       -- user skill profile
  PUT    /api/v1/users/{id}/skills       -- replace skill profile

SKILLS
  GET    /api/v1/skills                  -- skill catalog
  POST   /api/v1/skills                  -- create custom skill [admin]

TEAMS
  GET    /api/v1/teams                   -- list teams
  POST   /api/v1/teams                   -- create team [admin/maintainer]
  GET    /api/v1/teams/{id}              -- team details + members
  PATCH  /api/v1/teams/{id}             -- update team
  POST   /api/v1/teams/{id}/members     -- add member { user_id, capacity_hours }
  DELETE /api/v1/teams/{id}/members/{user_id}

PROJECTS
  GET    /api/v1/projects                -- list projects (role-filtered)
  POST   /api/v1/projects                -- create project
  GET    /api/v1/projects/{id}           -- project details
  PATCH  /api/v1/projects/{id}          -- update project
  DELETE /api/v1/projects/{id}          -- archive [admin/maintainer]

EPICS
  GET    /api/v1/projects/{id}/epics     -- list epics
  POST   /api/v1/projects/{id}/epics     -- create epic
  GET    /api/v1/epics/{id}              -- epic details + progress
  PATCH  /api/v1/epics/{id}             -- update epic
  DELETE /api/v1/epics/{id}

RELEASES
  GET    /api/v1/projects/{id}/releases  -- list releases
  POST   /api/v1/projects/{id}/releases  -- create release
  GET    /api/v1/releases/{id}           -- release + stages
  PATCH  /api/v1/releases/{id}          -- update release
  GET    /api/v1/releases/{id}/stages    -- list stages
  POST   /api/v1/releases/{id}/stages    -- create stage
  GET    /api/v1/stages/{id}             -- stage details
  PATCH  /api/v1/stages/{id}            -- update stage

BACKLOG
  GET    /api/v1/projects/{id}/backlog   -- list items, query params:
                                         --   ?epic={id}  ?release={id}  ?stage={id}
                                         --   ?status=backlog,in_progress
                                         --   ?assignee={id}  ?unplanned=true
                                         --   ?sort=priority&order=asc
                                         --   ?page=1&per_page=50
  POST   /api/v1/projects/{id}/backlog   -- create item
  GET    /api/v1/backlog/{id}            -- item details + tasks + tests
  PATCH  /api/v1/backlog/{id}           -- update item (status, epic, stage, release, priority...)
  DELETE /api/v1/backlog/{id}
  GET    /api/v1/backlog/{id}/tasks      -- tasks for item
  POST   /api/v1/backlog/{id}/tasks      -- create task

TASKS
  GET    /api/v1/tasks/{id}              -- task details
  PATCH  /api/v1/tasks/{id}            -- update task
  DELETE /api/v1/tasks/{id}
  POST   /api/v1/tasks/{id}/time         -- log time { hours, date, note }
  GET    /api/v1/tasks/{id}/time         -- time entries for task

TESTS
  GET    /api/v1/projects/{id}/tests     -- all project tests (filterable)
  POST   /api/v1/projects/{id}/tests     -- create test (body includes backlog_item_id or epic_id)
  GET    /api/v1/tests/{id}              -- test details
  PATCH  /api/v1/tests/{id}            -- update test (status, steps, etc.)
  DELETE /api/v1/tests/{id}

STATS
  GET    /api/v1/projects/{id}/stats/overview    -- summary: items by status, velocity
  GET    /api/v1/projects/{id}/stats/capacity    -- team capacity vs load in period
  GET    /api/v1/projects/{id}/stats/time        -- hours by member, by skill, by period

REAL-TIME
  GET    /api/v1/projects/{id}/events    -- SSE stream: item updates, status changes
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

### Фаза 0 -- Фундамент (3-4 дня)
- [ ] `go mod init`, структура директорий
- [ ] `docker-compose.yml`: postgres + adminer (для дебага схемы)
- [ ] `Makefile`: `make dev`, `make build`, `make migrate-up`, `make migrate-down`, `make sqlc`
- [ ] `config.go`: читаем `.env`, валидируем при старте (нет конфига -- не запускается)
- [ ] Подключение к БД с healthcheck
- [ ] `golang-migrate` setup, первая пустая миграция
- [ ] `chi` router, базовый `/api/v1/health` endpoint
- [ ] Логгер (structured JSON logs)

### Фаза 1 -- Схема данных (3-4 дня)
- [ ] Все миграции из раздела "Схема" выше
- [ ] `sqlc.yaml` config, базовые queries для всех таблиц
- [ ] `make sqlc` -- генерируем Go-код
- [ ] Проверяем на реальной БД (adminer -- наш друг)

### Фаза 2 -- Auth (2-3 дня)
- [ ] `POST /auth/login` -- bcrypt проверка, выдача JWT
- [ ] `POST /auth/refresh` -- refresh token rotation
- [ ] `GET /auth/me`
- [ ] JWT middleware (chi middleware)
- [ ] Role middleware
- [ ] Seed: один admin-пользователь при первом запуске

### Фаза 3 -- Пользователи и команды (2-3 дня)
- [ ] CRUD users
- [ ] CRUD skills (builtin seed + custom)
- [ ] CRUD member_skills
- [ ] CRUD teams + team members

### Фаза 4 -- Рабочие элементы (5-7 дней)
- [ ] CRUD projects
- [ ] CRUD epics (с автоматическим прогрессом)
- [ ] CRUD backlog items (с фильтрацией по всем измерениям)
- [ ] CRUD tasks
- [ ] CRUD tests (на всех уровнях)
- [ ] Time logging

### Фаза 5 -- Таймлайн (2-3 дня)
- [ ] CRUD releases
- [ ] CRUD stages
- [ ] Привязка backlog items к stage/release

### Фаза 6 -- Статистика (2-3 дня)
- [ ] Overview endpoint
- [ ] Capacity vs load
- [ ] Time by member/skill

### Фаза 7 -- SSE Real-time (1-2 дня)
- [ ] SSE endpoint для проекта
- [ ] Broadcast при изменении item status

### Фаза 8 -- React UI (параллельно с 3-7, или после)
- [ ] Vite setup, TypeScript, базовый API-клиент
- [ ] Auth flow (login, token refresh)
- [ ] Project list + project dashboard
- [ ] Backlog view (список + фильтры)
- [ ] Sprint board (dnd-kit, columns by status)
- [ ] Epic board
- [ ] Timeline view (releases + stages)
- [ ] Capacity planning view

---

## Правила разработки

1. **Миграции -- только вперёд.** Никогда не редактируем существующую миграцию.
   Сломали -- пишем новую миграцию которая исправляет.

2. **sqlc -- источник истины для типов БД.** Не пишем SQL в Go-коде вручную.
   Всё -- через `.sql` файлы в `db/queries/`, потом `make sqlc`.

3. **Domain logic -- без HTTP и без SQL.** `internal/domain/` не импортирует
   `net/http` и не знает про sqlc. Это позволяет тестировать бизнес-логику без БД.

4. **API тесты с первого дня.** Каждый новый endpoint -- минимум один интеграционный тест
   с реальной тестовой БД. Это не обсуждается -- ради этого и строим V.42.

5. **Один `.env.example`.** Все конфиг-параметры задокументированы там.
   Никаких магических дефолтов в коде -- всё явно.

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

## Что дальше

Фаза 0 -- фундамент. Создаём структуру, поднимаем postgres, пишем healthcheck.
Первый `make dev` который ничего не делает, но делает это стабильно и с логами.
