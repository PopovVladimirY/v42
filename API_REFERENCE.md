# V.42 API Reference

All routes are prefixed with `/api/v1`.
Auth: `Authorization: Bearer <access_token>` (except public routes).
Responses always follow the envelope: `{ "data": ..., "meta": ..., "error": ... }`.

---

## Envelope

```json
// Success (list)
{ "data": [...], "meta": { "total": 42, "page": 1, "per_page": 20 }, "error": null }

// Success (single)
{ "data": { ... }, "meta": null, "error": null }

// Error
{ "data": null, "meta": null, "error": { "code": "NOT_FOUND", "message": "..." } }
```

Error codes are strings: `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
`VALIDATION_ERROR`, `INTERNAL_ERROR`.

---

## Health

| Method | Path | Auth |
|--------|------|------|
| GET | `/health` | None |

Returns `{ "status": "ok" }` when the API process and DB connection are healthy.

---

## Events (SSE)

| Method | Path | Auth |
|--------|------|------|
| GET | `/events` | JWT via `?access_token=` query param (or `Bearer` header) |

Long-lived `text/event-stream` connection broadcasting cache-invalidation hints
(entity type + id, never payload) for live dashboards. Named SSE events; heartbeat
every 25s. Full contract, event catalog, and the React client hook are documented
in [SSE_GUIDE.md](SSE_GUIDE.md).

---

## AUTH

| Method | Path | Auth |
|--------|------|------|
| POST | `/auth/login` | None (rate-limited) |
| POST | `/auth/refresh` | None (rate-limited) |
| POST | `/auth/logout` | JWT |
| GET | `/auth/me` | JWT |
| PATCH | `/auth/me` | JWT |
| POST | `/auth/change-password` | JWT |

### POST /auth/login

```json
// Request
{ "email": "admin@example.com", "password": "secret123" }

// Response
{
  "data": {
    "access_token": "eyJ...",
    "user": { "id": "uuid", "email": "...", "display_name": "...", "role": "admin", "is_active": true }
  }
}
```

Also sets an httpOnly cookie with the refresh token.
Rate-limited: burst=10, then 1 req/6s per IP.

### POST /auth/refresh

Uses the httpOnly refresh cookie. Returns a new access token + rotated refresh cookie.
Replay detection: if a revoked token is replayed, all user tokens are revoked.

### POST /auth/logout

Revokes the current refresh token. Idempotent.

### GET /auth/me

Returns the current user's profile (from JWT claims + DB).

### PATCH /auth/me

```json
// Request (partial -- only send fields to change)
{ "theme": "dark", "idle_timeout_minutes": 30 }
```

### POST /auth/change-password

```json
// Request
{ "current_password": "old", "new_password": "new-strong-pass" }
```

Clears the `must_change_password` flag. Required on first login if flag is set.

---

## USERS

| Method | Path | Auth |
|--------|------|------|
| GET | `/users` | JWT |
| POST | `/users` | JWT + admin |
| GET | `/users/{id}` | JWT |
| PATCH | `/users/{id}` | JWT (self or admin) |
| PATCH | `/users/{id}/reset-password` | JWT + admin |
| GET | `/users/{id}/skills` | JWT |
| PUT | `/users/{id}/skills/{skill_id}` | JWT (self or admin) |
| DELETE | `/users/{id}/skills/{skill_id}` | JWT (self or admin) |

### GET /users

Returns all users. Admin/maintainer see inactive users; others see active only.

### POST /users

```json
// Request
{ "email": "dev@example.com", "password": "temp-pass", "display_name": "Alex", "role": "developer" }
```

Roles: `admin`, `maintainer`, `developer`, `tester`, `observer`.
Creates user with `must_change_password = true`.

### PATCH /users/{id}

```json
// Request (partial)
{ "display_name": "New Name", "avatar_url": "https://...", "role": "tester", "is_active": true }
```

Self-update: `display_name`, `avatar_url` only. Admin: all fields.
Guard: admin cannot deactivate their own account.

### PATCH /users/{id}/reset-password

```json
// Request
{ "new_password": "reset-pass" }
```

Sets `must_change_password = true`. Forces password change on next login.

### GET /users/{id}/skills

Returns user's skill profile with proficiency and interest levels.

```json
// Response (data array)
[
  {
    "user_id": "uuid",
    "skill_id": "uuid",
    "skill_name": "Go",
    "skill_category": "Backend",
    "level": "proficient",
    "interest": "high",
    "interest_note": "want to learn GAS"
  }
]
```

### PUT /users/{id}/skills/{skill_id}

```json
// Request
{ "level": "competent", "interest": "medium", "interest_note": "..." }
```

Valid `level` values: `novice`, `beginner`, `competent`, `proficient`, `expert`.
Valid `interest` values: `low`, `medium`, `high`.
Upserts: inserts or updates the skill entry.

---

## SKILLS

| Method | Path | Auth |
|--------|------|------|
| GET | `/skills` | JWT |
| POST | `/skills` | JWT + admin |
| PATCH | `/skills/{id}` | JWT + admin |
| PATCH | `/skills/{id}/hidden` | JWT + admin |
| DELETE | `/skills/{id}` | JWT + admin |

### GET /skills

Returns visible skills. `?all=true` (admin only) includes hidden skills.

```json
// Response (data array)
[{ "id": "uuid", "name": "Go", "category": "Backend", "is_builtin": true, "is_hidden": false }]
```

### POST /skills

```json
// Request
{ "name": "Rust", "category": "Systems" }
```

### PATCH /skills/{id}/hidden

```json
// Request
{ "hidden": true }
```

Built-in skills cannot be deleted; hide them instead.

### DELETE /skills/{id}

Cannot delete built-in skills (returns 409). Use `PATCH /skills/{id}/hidden` instead.

---

## TEAMS

| Method | Path | Auth |
|--------|------|------|
| GET | `/teams` | JWT |
| GET | `/teams/mine` | JWT |
| POST | `/teams` | JWT + admin/maintainer |
| GET | `/teams/{id}` | JWT |
| PATCH | `/teams/{id}` | JWT + admin/maintainer |
| DELETE | `/teams/{id}` | JWT + admin |
| PATCH | `/teams/{id}/archive` | JWT + admin |
| PATCH | `/teams/{id}/unarchive` | JWT + admin |
| PATCH | `/teams/{id}/category` | JWT + admin |
| POST | `/teams/{id}/members` | JWT + admin/maintainer |
| DELETE | `/teams/{id}/members/{user_id}` | JWT + admin/maintainer |

### GET /teams

Returns all teams (non-archived by default).

### GET /teams/mine

Returns teams the current user belongs to.

### POST /teams

```json
// Request
{ "name": "Backend Team", "description": "Go & Postgres experts" }
```

### PATCH /teams/{id}

```json
// Request (partial)
{ "name": "New Name", "description": "Updated" }
```

### PATCH /teams/{id}/category

```json
// Request
{ "category": "normal" }
```

Valid categories: `normal`, `admin_team`, `management_team`.

### POST /teams/{id}/members

```json
// Request
{ "user_id": "uuid", "capacity_hours": 32 }
```

`capacity_hours`: weekly capacity in hours (default 32).

---

## PROJECTS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects` | JWT |
| GET | `/projects/archived` | JWT + admin |
| POST | `/projects` | JWT + admin/maintainer |
| GET | `/projects/{project_id}` | JWT |
| PATCH | `/projects/{project_id}` | JWT + admin/maintainer |
| DELETE | `/projects/{project_id}` | JWT + admin |
| PATCH | `/projects/{project_id}/archive` | JWT + admin |
| PATCH | `/projects/{project_id}/unarchive` | JWT + admin |
| GET | `/projects/{project_id}/tree` | JWT |
| POST | `/projects/{project_id}/children` | JWT + admin/maintainer |
| PATCH | `/projects/{project_id}/move` | JWT + admin/maintainer |
| GET | `/projects/{project_id}/teams` | JWT |
| POST | `/projects/{project_id}/teams` | JWT + admin/maintainer |
| DELETE | `/projects/{project_id}/teams/{team_id}` | JWT + admin/maintainer |

### GET /projects

```
?team_id={uuid}   -- filter by team
?status=active    -- active | on_hold | archived
```

Users see projects where they are a member of at least one linked team.
Admin sees all projects.

### POST /projects

```json
{ "name": "V42", "description": "The project management system", "status": "active", "team_id": "uuid" }
```

`team_id` is optional. If provided, immediately links the team.

### GET /projects/{project_id}/tree

Returns the hierarchical project node tree. Useful for structured project portfolios.
`?show_archived=true` includes archived nodes.

### POST /projects/{project_id}/children

Creates a child node (sub-project or phase) under this project.

```json
{ "name": "Phase 1", "description": "..." }
```

### PATCH /projects/{project_id}/move

Moves a project node in the hierarchy.

```json
{ "parent_id": "uuid-or-null", "order_index": 2 }
```

### POST /projects/{project_id}/teams

```json
{ "team_id": "uuid" }
```

Links a team to the project (M:M relationship).

---

## EPICS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/epics` | JWT |
| POST | `/projects/{project_id}/epics` | JWT + admin/maintainer |
| GET | `/projects/{project_id}/epics/{id}` | JWT |
| PATCH | `/projects/{project_id}/epics/{id}` | JWT + admin/maintainer |
| DELETE | `/projects/{project_id}/epics/{id}` | JWT + admin/maintainer |

### GET /projects/{project_id}/epics

Returns all epics in the project.

### POST /projects/{project_id}/epics

```json
{
  "title": "Authentication System",
  "description": "Complete auth flow with JWT + refresh tokens",
  "status": "draft",
  "clarity": "clear",
  "target_date": "2026-06-30"
}
```

`status` values: `draft`, `active`, `done`, `cancelled`.
`clarity` values: `unknown`, `foggy`, `tacit`, `scoped`, `clear`.

### PATCH /projects/{project_id}/epics/{id}

Partial update. Any field from Create is patchable.

---

## BACKLOG

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/backlog` | JWT |
| POST | `/projects/{project_id}/backlog` | JWT |
| GET | `/projects/{project_id}/backlog/{id}` | JWT |
| PATCH | `/projects/{project_id}/backlog/{id}` | JWT |
| DELETE | `/projects/{project_id}/backlog/{id}` | JWT |
| POST | `/projects/{project_id}/backlog/reorder` | JWT |

### GET /projects/{project_id}/backlog

```
?epic_id={uuid}     -- filter by epic
?status=backlog     -- backlog | ready | in_progress | review | done | cancelled
?clarity=foggy      -- unknown | foggy | tacit | scoped | clear
?assignee_id={uuid}
?page=1&per_page=50
```

### POST /projects/{project_id}/backlog

```json
{
  "title": "User can log in",
  "description": "As a user I want to log in so I can access my workspace",
  "type": "story",
  "status": "backlog",
  "priority": 10.0,
  "estimate": "3h",
  "epic_id": "uuid",
  "release_id": "uuid",
  "stage_id": "uuid",
  "assignee_id": "uuid",
  "skill_required": "uuid",
  "clarity": "clear",
  "ac_setup": "User exists with valid email/password",
  "ac_steps": "1. Open /login\n2. Enter credentials\n3. Click Login",
  "ac_expected": "Redirected to /dashboard with user name shown in header"
}
```

`type` values: `story`, `bug`, `feature`, `technical_debt`.
`priority` is FLOAT8; use the `reorder` endpoint for drag-and-drop reordering.
`ac_setup`, `ac_steps`, `ac_expected`: acceptance criteria / ATDD fields.

### POST /projects/{project_id}/backlog/reorder

Atomically reorders items (e.g., after drag-and-drop).

```json
{ "items": [{ "id": "uuid-a", "priority": 0 }, { "id": "uuid-b", "priority": 1 }] }
```

---

## TASKS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/tasks` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tasks` | JWT |
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{id}` | JWT |
| PATCH | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{id}` | JWT |
| DELETE | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{id}` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{id}/move` | JWT |

### POST .../tasks

```json
{
  "title": "Implement bcrypt password check",
  "description": "Use bcrypt.CompareHashAndPassword",
  "status": "todo",
  "estimate": "2h",
  "order_index": 0,
  "assignee_id": "uuid",
  "skill_required": "uuid",
  "reviewer_id": "uuid"
}
```

`status` values: `todo`, `in_progress`, `done`, `cancelled`.

### POST .../tasks/{id}/move

Moves a task to a different backlog item.

```json
{ "target_item_id": "uuid" }
```

---

## TIME LOGGING

| Method | Path | Auth |
|--------|------|------|
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time` | JWT |
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time` | JWT |
| DELETE | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/time/{entry_id}` | JWT |

### POST .../time

```json
{ "hours": 1.5, "logged_date": "2026-05-24", "note": "Implemented login endpoint" }
```

`hours`: positive decimal (e.g., `0.5` for 30 min).
`logged_date`: defaults to today if omitted.
Time entries are immutable: to correct, delete and re-log.

---

## COMMENTS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/comments` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/comments` | JWT |
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/comments` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tasks/{task_id}/comments` | JWT |
| PATCH | `/comments/{id}` | JWT (author) |
| DELETE | `/comments/{id}` | JWT (author or admin) |

Currently implemented on backlog items and tasks. Comments on epics, releases, stages,
and tests are planned (Phase 5/6).

### POST .../comments

```json
{ "body": "This needs clarification on error states", "parent_id": "uuid-optional" }
```

One level of threading: replies to a comment. No nested replies.

### DELETE /comments/{id}

Soft delete: body is nulled but the thread node remains. Observer role cannot write comments.

---

## TESTS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/tests` | JWT |
| POST | `/projects/{project_id}/tests` | JWT |
| GET | `/projects/{project_id}/tests/{test_id}` | JWT |
| PATCH | `/projects/{project_id}/tests/{test_id}` | JWT |
| DELETE | `/projects/{project_id}/tests/{test_id}` | JWT |
| GET | `/projects/{project_id}/epics/{epic_id}/tests` | JWT |
| POST | `/projects/{project_id}/epics/{epic_id}/tests` | JWT |
| GET | `/projects/{project_id}/backlog/{backlog_item_id}/tests` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tests` | JWT |
| POST | `/projects/{project_id}/backlog/{backlog_item_id}/tests/{test_id}/move` | JWT |

Tests live at three scopes:
- **Project-level** (`/projects/{id}/tests`): regression tests, integration tests
- **Epic-level** (`/projects/{id}/epics/{epic_id}/tests`): epic acceptance tests
- **Backlog item-level** (`/projects/{id}/backlog/{item_id}/tests`): item acceptance criteria as tests

### POST /projects/{project_id}/tests

```json
{
  "title": "Login flow -- happy path",
  "type": "acceptance",
  "description": "End-to-end test for successful login",
  "setup": "Clean user account with email=test@example.com, password=pass123",
  "config": "Browser: Chrome, headless=false",
  "steps": "1. Open /login\n2. Enter credentials\n3. Click Login\n4. Wait for redirect",
  "expected_results": "User lands on /dashboard, name shown in header, no error messages"
}
```

`type` values: `manual`, `acceptance`, `integration`, `unit`.

### POST .../tests/{test_id}/move

Moves a test from one backlog item to another.

```json
{ "target_item_id": "uuid" }
```

---

## SPRINTS

| Method | Path | Auth |
|--------|------|------|
| GET | `/projects/{project_id}/sprints` | JWT |
| POST | `/projects/{project_id}/sprints` | JWT + admin/maintainer |
| GET | `/projects/{project_id}/sprints/{id}` | JWT |
| PATCH | `/projects/{project_id}/sprints/{id}` | JWT + admin/maintainer |
| DELETE | `/projects/{project_id}/sprints/{id}` | JWT + admin/maintainer |
| GET | `/projects/{project_id}/sprints/{id}/items` | JWT |
| POST | `/projects/{project_id}/sprints/{id}/items` | JWT |
| DELETE | `/projects/{project_id}/sprints/{id}/items/{backlog_item_id}` | JWT |
| POST | `/projects/{project_id}/sprints/{id}/test-results/init` | JWT |
| GET | `/projects/{project_id}/sprints/{id}/test-results` | JWT |
| PATCH | `/projects/{project_id}/sprints/{id}/test-results/{result_id}` | JWT |

### POST /projects/{project_id}/sprints

```json
{
  "name": "Sprint 3",
  "team_id": "uuid",
  "goal": "Ship auth + backlog CRUD",
  "status": "planning",
  "start_date": "2026-06-01",
  "end_date": "2026-06-14",
  "capacity_hours": 160
}
```

### PATCH /projects/{project_id}/sprints/{id}

Partial update. Setting `status: "active"` auto-calls test-results/init.

### POST .../sprints/{id}/items

```json
{ "backlog_item_id": "uuid" }
```

### POST .../sprints/{id}/test-results/init

Seeds `sprint_test_results` rows (status=`skipped`) for all tests and backlog items in the sprint.
Called automatically when sprint status changes to `active`. Safe to call manually.

### PATCH .../sprints/{id}/test-results/{result_id}

```json
{
  "status": "pass",
  "skip_reason": null,
  "notes": "Tested on Chrome 125, all steps passed"
}
```

`status` values: `pass`, `failed`, `skipped`, `disabled`, `on_hold`.

Auto-skip logic: when a test fails and other tests depend on it via `test_dependencies`,
those dependents remain `skipped` with `skip_reason = "dependency test {id} failed"`.

---

## CAPACITY ANALYTICS

| Method | Path | Auth |
|--------|------|------|
| GET | `/users/{id}/skill-radar` | JWT |
| GET | `/users/{id}/learning-appetite` | JWT |
| GET | `/users/{id}/engagement` | JWT |
| GET | `/teams/{id}/skill-matrix` | JWT |
| GET | `/teams/{id}/tandems` | JWT |
| GET | `/teams/{id}/learning-appetite` | JWT |
| GET | `/teams/{id}/skill-coverage` | JWT |
| GET | `/teams/{id}/member-capacity` | JWT |

### GET /users/{id}/skill-radar

Returns skill profile data formatted for radar chart visualization.
Includes two data series: proficiency levels and interest levels per skill.

### GET /users/{id}/learning-appetite

Analyzes the user's skill interest signals: which skills they want to grow,
across which categories, and at what current vs desired level delta.

### GET /users/{id}/engagement

Computed engagement score based on skill activity, interest declarations, and task throughput.

### GET /teams/{id}/skill-matrix

Returns a matrix of `members x skills` with proficiency/interest per cell.
Used for the team skills overview board.

### GET /teams/{id}/tandems

Identifies pairing opportunities: team members where one is expert and another is a beginner
in the same skill, enabling structured mentoring.

```json
// Response (data array)
[{ "mentor": { "user_id": "...", "name": "..." }, "mentee": { ... }, "skill": { ... } }]
```

### GET /teams/{id}/skill-coverage

```
?skill_id={uuid}   -- required
```

Returns count of team members at each proficiency level for the specified skill.

### GET /teams/{id}/member-capacity

Returns per-member capacity vs assigned workload.

```json
// Response (data array)
[{ "user_id": "uuid", "name": "Alex", "capacity_hours": 32, "assigned_hours": 28, "utilization_pct": 87.5 }]
```

---

## PLANNED (not yet implemented)

The following groups are designed and documented in DESIGN.md but not yet implemented.

### Releases & Stages (Phase 5)

```
GET    /projects/{id}/releases
POST   /projects/{id}/releases
GET    /projects/{id}/releases/{release_id}
PATCH  /projects/{id}/releases/{release_id}
GET    /projects/{id}/releases/{release_id}/stages
POST   /projects/{id}/releases/{release_id}/stages
GET    /stages/{id}
PATCH  /stages/{id}
```

Releases model WHEN things ship. Stages are ordered phases within a release.
Backlog items reference `release_id` and `stage_id` (nullable FKs already in schema).

### Goals Layer (Phase 7)

```
GET/POST    /projects/{id}/goals
GET/PATCH/DELETE  /goals/{id}
PUT/DELETE  /goals/{id}/vote
GET/POST/PATCH/DELETE  /goals/{id}/items
GET/POST/DELETE  /goals/{id}/epics
GET  /goals/{id}/progress
GET  /projects/{id}/goals/priority
GET  /projects/{id}/goals/matrix
GET  /projects/{id}/goals/recommendation
```

Goals are the WHY layer. Not epics (what/how). See DESIGN.md for the full model.

### Stats (Phase 6b)

```
GET  /projects/{id}/stats/overview
GET  /projects/{id}/stats/capacity
GET  /projects/{id}/stats/time
GET  /sprints/{id}/burndown
GET  /projects/{id}/velocity
```

### Extended Comments (Phase 6b)

Comments on epics, releases, stages, and tests are planned but not yet wired up.

### SSE Real-time (Phase 7)

```
GET  /projects/{id}/events
```

Server-Sent Events stream for live item updates, status changes, and comments.
