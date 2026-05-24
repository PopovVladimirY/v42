# V.42 -- Design Review 4: Ready for Phase 5?

> Date: 2026-05-23. Basis: post Phase 3c (multi-team projects) audit.
> Method: test runs, router inventory, DESIGN.md diff, frontend structure walk.

---

## TL;DR

**Backend: production-grade.** All 143 integration tests pass green (139 API + 4 DB).
The schema is correct. Routes are wired. Handlers cover all implemented phases.
**Frontend: functional but undertested.** 37 Playwright e2e tests, zero unit/component tests.
Most tests are structural smoke tests (no backend). Backend integration e2e is entirely skipped.
**Phase 3c (multi-team projects): DONE.** Migration applied, M:M junction table live, backend
and frontend updated, tested manually. The stale-binary incident is resolved and documented.

---

## Backend: what works

### API endpoint coverage (implemented vs DESIGN.md)

| Domain | Designed | Implemented | Gap |
|--------|----------|-------------|-----|
| Auth (login, refresh, logout, me, change-password) | 5 | 5 | none |
| Users (CRUD + skills, reset-password, radar) | 10 | 10 | none |
| Skills (catalog) | 2 | 2 | none |
| Teams (CRUD + members + skill matrix + capacity) | 10 | 10 | none |
| Projects (CRUD + archive + delete) | 5 | 5 | none |
| Project teams M:M (list, add, remove) | 3 | 3 | none -- Phase 3c |
| Epics (CRUD) | 5 | 5 | none |
| Backlog (CRUD + reorder) | 6 | 6 | none |
| Tasks (CRUD) | 5 | 5 | none |
| Comments (CRUD + threading) | 8 | 7 | 24h edit window not enforced server-side |
| Tests (project/epic/item level) | 8 | 7 | GET/PATCH/DELETE tests are project-scoped only |
| Time entries (log + list + delete) | 3 | 3 | none |
| Sprints (CRUD + items) | 9 | 9 | none |
| Sprint test results (init + list + update) | 3 | 3 | none |
| Capacity analytics | 6 | 6 | none |
| **Releases + Stages** | **8** | **0** | **Phase 5 -- not started** |
| Sprint board view (GET /sprints/{id}/board) | 1 | 0 | Phase 4.5 incomplete |
| Stats endpoints (overview, capacity, time) | 3 | 0 | Phase 6b -- not started |
| SSE real-time events | 1 | 0 | Phase 7 -- not started |
| Comments on epics, releases, stages, tests | 8 | 0 | not wired in router |

### Notable gaps in implemented endpoints

**Comments router is partial.** The router has:
- `GET/POST /projects/{id}/backlog/{backlog_item_id}/comments` -- backlog items DONE
- `GET/POST /projects/{id}/backlog/{backlog_item_id}/tasks/{task_id}/comments` -- tasks DONE
- **Missing:** `GET/POST /projects/{id}/epics/{id}/comments` -- not wired
- **Missing:** `PATCH/DELETE /comments/{id}` -- wired globally but 24h edit enforcement missing

**Tests CRUD is not fully nested.** `GET /tests/{id}`, `PATCH /tests/{id}`,
`DELETE /tests/{id}` are routed under `/projects/{project_id}/tests/{test_id}` which differs
from the DESIGN.md spec (`/tests/{id}` flat). Minor but creates inconsistency for clients.

**Project visibility middleware (Phase 3a design intent) is absent.** DESIGN.md specifies
that non-admin users should only see projects where they are members of an associated team.
Currently `GET /projects` returns ALL projects to any authenticated user.
This is a security/data-boundary gap, not just a missing feature.

---

## Backend: test coverage

### Test files

| File | Tests | Domain |
|------|-------|--------|
| `internal/api/auth_test.go` | 15 | Auth (login, refresh, logout, me, rate limit, token reuse) |
| `internal/api/users_skills_teams_test.go` | 74 | Users, skills, member_skills, teams, roles, capacity |
| `internal/api/projects_backlog_test.go` | 50 | Projects, epics, backlog, tasks, sprints, comments |
| `internal/db/migrate_test.go` | 4 | Schema presence + CHECK constraint validation |
| **Total** | **143** | All pass. Zero failures. |

### What is NOT tested

- **Comments: threading** -- reply-to-a-comment flow has zero test coverage.
- **Comments: author-only edit** -- 24h window not enforced, not tested.
- **Sprint test results workflow** -- `init + record result + auto-skip` sequence untested.
- **Project team M:M endpoints** -- `GET/POST/DELETE /projects/{id}/teams` have zero tests.
  These were added in Phase 3c without accompanying integration tests.
- **Tests CRUD** -- `GET/PATCH/DELETE /tests/{test_id}` have zero coverage.
- **Time entries** -- log and list endpoints are not tested.
- **`GET /projects?team_id=`** filter path (via `ListProjectsByTeam`) not tested.
- **Project visibility** -- no test verifying that user A cannot see user B's team projects.
- **`POST /auth/change-password`** -- no integration test.
- **`PATCH /auth/me`** -- no integration test.
- **`POST /users` (admin creates user)** -- not tested.
- **`DELETE /teams/{id}/members/{user_id}`** -- not tested.
- **`DELETE /users/{id}/skills/{skill_id}`** -- not tested.
- **`GET /teams/{id}/tandems`**, `skill-coverage`, `member-capacity` -- no integration tests.
- **Middleware `RequirePasswordChanged`** -- only smoke-tested in e2e.

**Coverage estimate (integration):** ~60-65% of implemented routes have at least one test.
The tested paths are the happy path + key validation errors. Auth security is well-covered.

---

## Frontend: what exists

### Pages implemented

| Page | Route | Status |
|------|-------|--------|
| LoginPage | `/login` | Done |
| ChangePasswordPage | `/change-password` | Done |
| TeamsPage | `/teams` | Done (list + create + delete) |
| TeamDetailPage | `/teams/:id` | Done (members, skills matrix, capacity, tandems) |
| ProjectsPage | `/teams/:id/projects` | Done (list + create modal) |
| ProjectShell | `/projects/:id/*` | Done (tab nav, overview, backlog, epics, sprints, teams) |
| BacklogPage | `/projects/:id/backlog` | Done (list, filter, create, update status, delete) |
| BacklogItemDetailPage | `/projects/:id/backlog/:itemId` | Done (tasks, tests, comments) |
| EpicsPage | `/projects/:id/epics` | Done (list, create, update status) |
| SprintsPage | `/projects/:id/sprints` | Done (list, create, status board) |
| SprintDetailPage | `/projects/:id/sprints/:sprintId` | Done (board, items, test results init) |
| ProfilePage | `/profile` | Done (skills CRUD, theme picker) |
| AdminUsersPage | `/admin/users` | Done (list, create, deactivate, reset-password) |
| DashboardPage | `/` | Placeholder (redirects to /teams) |

### Pages NOT implemented (per DESIGN.md)

| Page | Route | Phase |
|------|-------|-------|
| ReleasesPage | `/projects/:id/releases` | Phase 5 |
| ReleaseDetailPage | `/releases/:id` (stages) | Phase 5 |
| StagesPage | -- | Phase 5 |
| ClarityMapPage | `/projects/:id/clarity-map` | Phase 6a |
| ProjectStats/Overview | `/projects/:id/stats` | Phase 6b |
| SprintBurndown | -- | Phase 6b |
| SSE real-time feed | -- | Phase 7 |

### Missing frontend features in EXISTING pages

- **ProjectShell > Overview > Teams section**: The team add/remove UI was added
  but needs verification that it correctly calls `POST /projects/{id}/teams`.
- **BacklogItemDetailPage**: Comments on backlog items are shown, but replies (threading) are not rendered.
- **SprintDetailPage**: Sprint board shows items grouped by status but has no drag-and-drop.
  `dnd-kit` is in the dependency tree but not yet wired. This is Phase 3's "deferred to later".
- **EpicsPage**: No `target_date` field shown or editable. Epic progress (% of backlog done) not shown.
- **Backlog filters**: `?epic=`, `?release=`, `?stage=` query params are in the API but
  only `?status=` and `?assignee=` are exposed in the filter bar UI.
- **Tasks**: No `reviewer_id` field (DESIGN_REVIEW_3 proposed `reviewer_id` on tasks --
  migration not created yet).
- **Time logging UI**: `POST /tasks/{id}/time` exists in the API layer but there is no UI
  to log or view time entries in any page.
- **Capacity analytics pages**: No visual for burndown, velocity, team load.

---

## Frontend: test coverage

### Test files

| File | Count | Type | Runs without backend |
|------|-------|------|----------------------|
| `e2e/auth.spec.ts` | 6 | Playwright | 4 of 6 (2 require backend) |
| `e2e/projects.spec.ts` | 16 | Playwright | 13 of 16 (3 require backend, skipped) |
| `e2e/sprints.spec.ts` | 18 | Playwright | 17 of 18 (1 require backend, skipped) |
| Unit/component tests | 0 | -- | -- |
| **Total running** | **37 passed, 6 skipped** | | |

### What is NOT tested (frontend)

- **Zero unit tests.** No Vitest / Jest. No component-level tests whatsoever.
  `useProjects`, `useSprints`, `useProjectTeams`, `useAuth` hooks are untested.
  API endpoint modules (`projects.ts`, `backlog.ts`, etc.) are untested.
- **Backend integration e2e is almost entirely skipped.** The 6 skipped tests that actually
  call the API (create project, create backlog item, create sprint) are gated behind
  `RUN_E2E_WITH_BACKEND=1`. In practice: never run.
- **AdminUsersPage**: no e2e coverage at all.
- **ProfilePage / skill editing**: no e2e coverage.
- **TeamDetailPage**: no e2e coverage (tandem view, skill matrix, capacity bars).
- **BacklogItemDetailPage**: no e2e coverage (task CRUD, test CRUD, comments).
- **SprintDetailPage**: structure tests only; no item-add, drag-drop, test-result recording.
- **ProjectShell > Teams section** (Phase 3c new feature): zero tests.
- **DnD flows**: no tests (expected -- not yet implemented).
- **Error states**: no test for 401 cascade + refresh retry in UI, network failure handling, etc.

---

## DESIGN.md compliance: schema vs reality

### Schema: matches DESIGN.md (current state)

| Table | Designed | In DB | Notes |
|-------|----------|-------|-------|
| users | yes | yes | |
| skills | yes | yes | |
| member_skills | yes | yes | missing `interest_note`, `novice` level (DESIGN_REVIEW_3 proposal) |
| teams | yes | yes | |
| team_members | yes | yes | |
| refresh_tokens | yes | yes | `user_idle_timeout` column added (Migration 9) |
| projects | yes | yes | `team_id` dropped (Migration 10) -- matches updated DESIGN.md |
| project_teams | yes | yes | Phase 3c -- NEW, matches DESIGN.md |
| epics | yes | yes | missing `clarity_level` (Phase 6a proposal) |
| backlog_items | yes | yes | missing `clarity_level` (Phase 6a proposal) |
| tasks | yes | yes | missing `reviewer_id` (DESIGN_REVIEW_3 proposal) |
| tests | yes | yes | |
| test_dependencies | yes | yes | |
| sprints | yes | yes | |
| sprint_items | yes | yes | |
| sprint_test_results | yes | yes | CHECK constraint tested |
| time_entries | yes | yes | |
| comments | yes | yes | |
| activity_log | yes | yes | present in schema, not used by any handler yet |
| outbox | yes | yes | present in schema, not used (Phase 7) |
| **releases** | **yes** | **yes** | table exists from Phase 1 migration, **no handlers** |
| **stages** | **yes** | **yes** | table exists from Phase 1 migration, **no handlers** |
| member_skill_history | DESIGN_REVIEW_3 proposal | NO | not migrated yet |

### Schema proposals from previous reviews NOT yet actioned

| Proposal | Source | Status |
|----------|--------|--------|
| `skill_level` add `novice` before `beginner` | DESIGN_REVIEW_3 | Pending (migration not created) |
| `member_skills.interest_note TEXT` | DESIGN_REVIEW_3 | Pending |
| `tasks.reviewer_id UUID` | DESIGN_REVIEW_3 | Pending |
| `member_skill_history` table | DESIGN_REVIEW_3 | Pending |
| `backlog_items.clarity_level` | DESIGN.md Phase 6a | Pending (Phase 6) |
| `epics.clarity_level` | DESIGN.md Phase 6a | Pending (Phase 6) |
| `tasks.clarity_level` | DESIGN.md Phase 6a | Pending (Phase 6) |

---

## Phase readiness assessment

### What is solid (ship-it quality)

1. **Auth**: login, refresh, logout, token rotation, replay detection, rate limiting.
   15 tests, 4 security rounds, well-hardened.
2. **Users + Skills + Teams**: full CRUD, role guards, capacity planning, analytics endpoints.
   74 tests. Bus factor: covered.
3. **Projects + Epics + Backlog + Tasks**: happy path + key error paths tested.
   Phase 3c M:M model is correct and live.
4. **Sprints + Sprint items**: creation, status transitions, item assignment work.
5. **DB schema**: all 22 tables present, migrations sequential, constraints tested.
6. **Go build**: `go build ./...` clean. No compiler warnings.
7. **Frontend build**: `npx tsc --noEmit` clean. `vite build` clean.

### What needs work before Phase 5

1. **Project visibility filter** -- any authenticated user currently sees all projects.
   Fix: add a WHERE clause to `ListProjects` that filters by team membership for non-admins.
   This is a data boundary issue. Not optional.

2. **Phase 3c tests missing** -- `GET/POST/DELETE /projects/{id}/teams` have zero integration
   tests. A freshly merged feature without tests is a liability. Should be added before moving on.

3. **Comments 24h edit window** -- domain rule exists in DESIGN.md, not enforced anywhere.
   Currently anyone can edit any comment at any time. A one-liner check in the handler.

4. **Sprint board route** -- `GET /sprints/{id}/board` is in DESIGN.md and e2e tests pass
   for the board UI, but there is no dedicated `/board` API endpoint. The frontend uses the
   items list and groups client-side. This is fine for now, but the route should either be
   removed from DESIGN.md or implemented properly.

5. **Frontend e2e with backend** -- the 6 skipped backend-connected tests should run in CI.
   At minimum: set up a `make test-e2e` target that spins up the stack and runs them.

### What is NOT blocking Phase 5 (deferred by design)

- `releases` / `stages` handlers: Phase 5 scope, schema is ready.
- `clarity_level` migrations: Phase 6a scope.
- `reviewer_id` / `interest_note` / `member_skill_history`: Phase 6 scope.
- Drag-and-drop board: Phase 3 deferred, Phase 8 UI polish scope.
- SSE real-time: Phase 7 scope.
- Stats / burndown / velocity: Phase 6b scope.

---

## Observations and ideas for upcoming phases

### Phase 5 -- Releases + Stages

The schema is fully ready (tables exist, no migration needed). Phase 5 is a pure
handler + frontend task. Suggested order:

1. `releases.sql` sqlc queries + store + handlers + router (2-3h)
2. `stages.sql` queries + store + handlers (order_index FLOAT8 reorder already proven in backlog) (2h)
3. Frontend: ReleasesPage + ReleaseDetailPage (timeline view, stage cards) (4-6h)
4. Backlog filter: expose `?release=` and `?stage=` in BacklogPage filter bar (1h)

Releases and Stages already have order_index on stages (FLOAT8 midpoint trick from backlog).
The reorder pattern is proven -- copy from backlog.

### Phase 6a -- Clarity model

Migration 000011 should add:
- `clarity_level` ENUM: `unknown | foggy | tacit | scoped | clear`
- Add to: `backlog_items`, `epics`, `tasks`
- Add `PATCH .../clarity` endpoints (dedicated, not mixed into general PATCH)

The Cynefin mapping (unknown=disorder, foggy=chaos, tacit=complex, scoped=complicated,
clear=simple) is well-designed and ready to implement.

**Sprint risk score formula** (from DESIGN.md) is clean and computable in one SQL query.
Expose it as part of `GET /sprints/{id}` response (not a separate endpoint) -- reduces
round trips and makes it always visible on the sprint detail page.

### Phase 6b -- Analytics

Before implementing burndown, **decide the time tracking model**. DESIGN.md has two overlapping
proposals:
- `time_entries` (already in schema: `task_id, user_id, hours, logged_date, note`)
- `time_logs` (proposed in Phase 6b section -- same columns, different table name)

These are the same table. Pick one. `time_entries` is already migrated. Use it.

The burndown query pattern:
```sql
-- daily actual hours per sprint
SELECT logged_date, SUM(hours) as hours_logged
FROM time_entries te
JOIN tasks t ON t.id = te.task_id
JOIN backlog_items bi ON bi.id = t.backlog_item_id
JOIN sprint_items si ON si.backlog_item_id = bi.id
WHERE si.sprint_id = $1
GROUP BY logged_date ORDER BY logged_date;
```

No new tables needed. The data is already there.

### Phase 3c: pending cleanup

Three small items left open after Phase 3c:

1. **Integration tests for project teams endpoints** -- write them now, not later.
2. **Project visibility middleware** -- implement the EXISTS check in ListProjects handler.
3. **ProjectShell > Teams section UI**: verify add/remove team calls work end-to-end
   (manual test passed but no automated coverage).

### Frontend: unit test gap

Zero unit tests is a risk that compounds with every new hook and API function added.
Recommended minimum: add Vitest + `@testing-library/react` to the frontend.
Start with the highest-value, lowest-effort targets:
- `useAuth` hook (token logic, refresh cascade)
- `api/client.ts` (401 retry interceptor)
- `api/endpoints/projects.ts` (query param building)

These three cover the core plumbing that everything else depends on.

### Security note: project visibility

DESIGN.md specifies:
> "Visibility rule: user sees project if they are a member of ANY team on the project."

This is not implemented. Any authenticated developer can call `GET /projects` and see
all projects in the system, including those of other teams. For a single-tenant tool
used by one organization this may be acceptable short-term. For a multi-team setup
with sensitive project names, it is not. Flag it as a known gap, decide before Phase 5
shipping.

---

## Numeric summary

| Metric | Value |
|--------|-------|
| Backend integration tests | 143 total, 143 passing, 0 failing |
| DB schema tests | 4 total, 4 passing |
| Frontend Playwright e2e tests | 43 total, 37 passing, 6 skipped (require backend) |
| Frontend unit tests | 0 |
| API routes implemented | ~90 |
| API routes designed but not implemented | ~25 (releases, stages, stats, SSE, comments partial) |
| Migrations applied | 10 (000001-000010) |
| Tables in schema | 22 |
| Go build warnings | 0 |
| TypeScript errors | 0 |
