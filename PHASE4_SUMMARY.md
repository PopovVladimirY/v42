# Design Review — Phase 4: Projects, Epics, Backlog, Tasks, Sprints, Comments

**Date:** 2025-07 / 2026-05  
**Reviewer:** Automated integration test suite + manual root-cause analysis  
**Status:** All bugs fixed. 136 integration tests passing (0 failures).

---

## Summary

Phase 4 implemented the core project-management domain: projects, epics, backlog items, tasks,
sprints (with sprint_items), and comments. The backend was feature-complete but contained
**22 distinct bugs** across handlers, stores, and the router (Audit Pass 1: 22 bugs, Audit Pass 2: 17 more).
An integration test suite of **48 new tests** was written across two audit passes.
All bugs are fixed; all tests pass.

Prior phases (2–3): 90 tests still pass — no regressions.

---

## Bug Inventory

| ID | Severity | Location | Description | Expected | Actual | Fix |
|---|---|---|---|---|---|---|
| ROUTING | High | `router.go` | `r.Route("/projects/{project_id}", ...)` subrouter shadows the top-level `r.Get/Patch/Delete("/projects/{id}", ...)` routes — chi captures the request before individual method handlers can fire | 200/204 | 404 | Moved Get/Update/Delete inside the subrouter, changed param name from `id` to `project_id` |
| BUG-01 | High | `handler_projects.go` Create | `ownerID` hardcoded as `""` — `parseUUID("")` fails — store returns error — 500 | 201 | 500 | Read `claims.UserID` from JWT context via `middleware.ClaimsFromContext` |
| BUG-02 | High | `handler_epics.go` Create | Same: `ownerID = ""` | 201 | 500 | Same fix as BUG-01 |
| BUG-03 | Medium | `handler_tasks_sprints.go` Sprint.Delete | No `ErrNotFound` check — handler always returns 500 on error | 404 | 500 | Added `errors.Is(err, domain.ErrNotFound)` branch |
| BUG-03b | Medium | `store/sprints.go` Delete | `DeleteSprint` returns nil for 0 rows deleted — handler never receives `ErrNotFound` | ErrNotFound | nil | Added `GetByID` pre-check before delete |
| BUG-04 | Medium | `handler_tasks_sprints.go` Sprint.AddItem | FK violation (non-existent sprint or backlog item) returns raw DB error — no ErrNotFound check | 404 | 500 | Detect `pgconn.PgError.Code == "23503"` in store, return `domain.ErrNotFound` |
| BUG-05 | Medium | `handler_tasks_sprints.go` Sprint.AddItem | Duplicate item — unique constraint violation not caught | 409 | 500 | Detect `pgconn.PgError.Code == "23505"` in store, return `domain.ErrConflict` |
| BUG-05b | Medium | `store/sprints.go` AddItem SQL | `ON CONFLICT DO NOTHING` silently ate duplicates — unique constraint never raised | 409 | 204 | Removed `ON CONFLICT DO NOTHING` from `queries/sprints.sql` and the generated file |
| BUG-06 | High | `handler_backlog.go` Get | No cross-project validation — a user could access a backlog item from project A via project B URL | 404 | 200 | After fetch, check `item.ProjectID != chi.URLParam(r, "project_id")` |
| BUG-07 | High | `handler_backlog.go` Delete | No cross-project validation before delete | 404 | 204 | Pre-fetch item and check `ProjectID` before deleting |
| BUG-09 | Low | `handler_comments_capacity.go` createComment / Update | `req.Body` checked for `== ""` without `TrimSpace` first — whitespace-only body accepted | 400 | 201 | Added `strings.TrimSpace(req.Body)` before empty check |
| BUG-10 | Low | `handler_tasks_sprints.go` Sprint.Update | Sprint name not trimmed/validated — empty-string name accepted | 400 | 200 | Added `TrimSpace` + empty check on `*req.Name` |
| BUG-11 | Medium | `handler_tasks_sprints.go` Sprint.Create/Update | Invalid date strings (e.g. `"not-a-date"`) propagated raw to `pgtype.Date.Scan` — store returned opaque error — 500 | 400 | 500 | Added `time.Parse("2006-01-02", ...)` validation before calling the store |
| BUG-12 | Medium | `handler_projects.go` Update | Status not enum-validated — any string accepted — DB constraint violation — 500 | 400 | 500 | Added `validProjectStatus` map, reject unknown values with 400 |
| BUG-13 | Medium | `handler_epics.go` Update | Status not enum-validated | 400 | 500 | Added `validEpicStatus` map |
| BUG-17 | Medium | `store/tasks.go` Create | FK violation (non-existent `backlog_item_id`) propagated as raw DB error | 404 | 500 | Added `pgconn.PgError.Code == "23503"` detection → `domain.ErrNotFound` |
| BUG-18 | High | `handler_backlog.go` Create | Default status `"open"` is not a valid `item_status` enum value | 201 | 500 | Changed default to `"backlog"` |
| BUG-18b | High | `handler_epics.go` Create | Default status `"open"` is not a valid `epic_status` enum value | 201 | 500 | Changed default to `"draft"` |
| BUG-18c | High | `handler_tasks_sprints.go` Task.Create | Default status `"open"` is not a valid `task_status` enum value | 201 | 500 | Changed default to `"todo"` |
| COMMENT-PARENT | High | `handler_comments_capacity.go` + `store/comments.go` | Handler passed both `project_id` AND `backlog_item_id`/`task_id` to `CreateComment` — violated `comments_exactly_one_parent` CHECK constraint | 201 | 500 | `project_id` in comments is a separate parent type (for project-level comments), not a FK label. Handlers now pass `""` (→ NULL) for `projectID` when the parent is a backlog item or task. Store updated to treat `""` as NULL. |
| FK-EPIC-CREATE | Medium | `store/epics.go` Create | FK violation for non-existent `project_id` propagated as raw error | 404 | 500 | Added `pgconn.PgError.Code == "23503"` detection → `domain.ErrNotFound` |
| DELETE-STALE-USER | Low | `auth_test.go` seedUser | Stale-user pre-cleanup `DELETE FROM users` failed silently when the user owned projects (FK violation) — caused duplicate key on next run | clean start | duplicate key error | Pre-cleanup now also deletes owned projects and backlog items before deleting the user |

---

## Bug Inventory — Audit Pass 2

A second full-pass audit of all Phase 4 handlers and stores found **17 more bugs**,
primarily: missing enum validation (handler passes bad value → DB 22P02 → 500), missing
cross-entity isolation checks (GET/PATCH/DELETE item via wrong parent URL succeeds),
and store-level FK errors not translated to `domain.ErrNotFound`.

| ID | Severity | Location | Description | Expected | Actual | Fix |
|---|---|---|---|---|---|-|
| AUDIT-A | Medium | `handler_backlog.go` Create | `type` field not validated → DB enum cast (22P02) → 500 | 400 | 500 | Added `validBacklogItemType` map; reject unknown values before store call |
| AUDIT-B | Medium | `handler_backlog.go` Update | `status` field not validated → 22P02 → 500 | 400 | 500 | Added `validBacklogItemStatus` map check |
| AUDIT-C | High | `handler_backlog.go` Update | No cross-project isolation — PATCH item A via project B URL succeeds | 404 | 200 | Pre-fetch item, compare `item.ProjectID != chi.URLParam(r, "project_id")` → 404 |
| AUDIT-D | High | `handler_tasks_sprints.go` Task.Get | No cross-backlog-item isolation — GET task via wrong backlog item URL returns 200 | 404 | 200 | After fetch, check `task.BacklogItemID != backlog_item_id` → 404 |
| AUDIT-E | Medium | `handler_tasks_sprints.go` Task.Update | `status` not validated → 22P02 → 500 | 400 | 500 | Added `validTaskStatus` map check |
| AUDIT-F | High | `handler_tasks_sprints.go` Task.Update | No cross-backlog-item isolation | 404 | 200 | Pre-fetch task, compare `BacklogItemID` → 404 |
| AUDIT-G | High | `handler_tasks_sprints.go` Task.Delete | No cross-backlog-item isolation | 404 | 204 | Pre-fetch task, compare `BacklogItemID` → 404; task preserved |
| AUDIT-H | Medium | `handler_tasks_sprints.go` Sprint.Create | `status` not validated after default-assign → 22P02 → 500 | 400 | 500 | Added `validSprintStatus` check after default `"planning"` assignment |
| AUDIT-I | Medium | `handler_tasks_sprints.go` Sprint.Update | `status` not validated → 22P02 → 500 | 400 | 500 | Added `validSprintStatus` check when `req.Status != nil` |
| AUDIT-J | High | `handler_tasks_sprints.go` Sprint.Get | No cross-project isolation — GET sprint via wrong project URL returns 200 | 404 | 200 | After fetch, check `sprint.ProjectID != project_id` → 404 |
| AUDIT-K | High | `handler_epics.go` Epic.Update | No cross-project isolation | 404 | 200 | Pre-fetch epic, compare `epic.ProjectID != project_id` → 404 |
| AUDIT-L | High | `handler_epics.go` Epic.Delete | No cross-project isolation; store also silent on missing row | 404 | 204/200 | Pre-fetch epic, compare `ProjectID`; `store/epics.go` Delete now calls `GetByID` first |
| AUDIT-M | Medium | `store/backlog.go` Create | FK violation (non-existent `project_id`) propagated as raw DB error | `ErrNotFound` | raw error | Added `pgconn` import + catch code `"23503"` → `domain.ErrNotFound` |
| AUDIT-M2 | Medium | `handler_backlog.go` Create | `domain.ErrNotFound` from store not checked → 500 | 404 | 500 | Added `errors.Is(err, domain.ErrNotFound)` → 404 branch |
| AUDIT-N | Medium | `store/comments.go` Create | FK violation (non-existent parent) propagated as raw DB error | `ErrNotFound` | raw error | Added `pgconn` import + catch code `"23503"` → `domain.ErrNotFound` |
| AUDIT-N2 | Medium | `handler_comments_capacity.go` Create | `domain.ErrNotFound` from store not checked → 500 | 404 | 500 | Added `errors.Is(err, domain.ErrNotFound)` → 404 branch |
| AUDIT-O | Medium | `store/sprints.go` RemoveItem | `:exec` returns nil for 0 rows deleted — handler responds 204 for item not in sprint | 404 | 204 | Changed SQL to `:one` with `RETURNING sprint_id`; hand-edited generated file; catch `pgx.ErrNoRows` → `domain.ErrNotFound` |

---

## Root Cause Patterns

### Pattern 1: Missing JWT context reads for owner fields
Three handlers (`projects.Create`, `epics.Create`, `handler_tasks_sprints.go`) had `ownerID`
or `createdBy` hardcoded as `""`. The middleware already validates the token and stores claims
in context — handlers just forgot to call `middleware.ClaimsFromContext(r.Context())`.

**Rule:** Any handler that creates a resource with an `owner_id` / `created_by` FK **must**
extract `claims.UserID` from the JWT context.

### Pattern 2: Wrong default enum values
Three handlers defaulted to `"open"` for status fields where `"open"` is not a valid enum:
- `item_status` valid values: `backlog`, `ready`, `in_progress`, `review`, `done`, `cancelled`
- `epic_status` valid values: `draft`, `active`, `done`, `cancelled`
- `task_status` valid values: `todo`, `in_progress`, `done`

**Rule:** Always reference `internal/db/gen/models.go` for the authoritative list of enum
values. Never guess — `"open"` sounds logical but is not in any of these enums.

### Pattern 3: Store Delete functions silently succeed on missing rows
`DELETE FROM x WHERE id = $1` returns no error when 0 rows are affected. All four stores
(`projects`, `sprints`, `tasks`, `comments`) had this — `Delete()` returned nil for
non-existent records, causing handlers to respond 204 instead of 404.

**Rule:** Any store `Delete` method that should return 404 for missing records must either:
(a) pre-fetch with `GetByID` and propagate `ErrNotFound`, or
(b) use `pgconn.CommandTag.RowsAffected()` and check `== 0`.

### Pattern 4: Unhandled pgconn errors
FK violations (`23503`) and unique constraint violations (`23505`) from PostgreSQL were
propagated as raw errors from store functions. Handlers that only check
`errors.Is(err, domain.ErrNotFound)` / `domain.ErrConflict` never matched them, falling
through to the `500 INTERNAL_ERROR` branch.

**Rule:** Store methods that can fail due to FK or unique constraints must wrap the error:
```go
var pgErr *pgconn.PgError
if errors.As(err, &pgErr) {
    switch pgErr.Code {
    case "23503": return domain.ErrNotFound
    case "23505": return domain.ErrConflict
    }
}
```

### Pattern 5: chi subrouter shadowing
`r.Route("/projects/{project_id}", fn)` mounts a subrouter that captures **all** requests
whose path starts with `/projects/`. Individual routes like `r.Get("/projects/{id}", ...)`,
`r.Patch("/projects/{id}", ...)` registered at the same level are **never reached** because
the subrouter fires first.

**Rule:** In chi, do not mix `r.Route("/x/{id}", ...)` subrouters with individual method
routes (`r.Get("/x/{id}", ...)`) at the same path prefix. Put all routes for a resource
inside a single subrouter.

### Pattern 6: comments table `exactly_one_parent` constraint
The `comments` table enforces that exactly one of
`project_id, epic_id, backlog_item_id, task_id, test_id` is non-null. The `project_id`
column is NOT a "belongs-to" FK — it is a parent type for project-level comments.
When creating a comment for a backlog item, ONLY `backlog_item_id` should be set.

**Rule:** Understand the domain semantics of polymorphic parent columns. Passing the
project_id from the URL route as a DB column value is wrong when it represents a different
relationship type.

### Pattern 7: Missing cross-entity isolation
Handlers for nested resources (tasks under backlog items, backlog items under projects,
epics under projects, sprints under projects) fetched by ID but never verified that the
fetched record actually belongs to the parent given in the URL. An attacker could:
- GET/PATCH/DELETE task X via `/projects/A/backlog/B/tasks/{X}` even if X belongs to item C.
- Read or mutate data across project boundaries with a valid JWT.

**Rule:** After every store fetch in a nested handler, compare the parent FK on the returned
record against `chi.URLParam(r, "parent_id")`. If they differ, respond 404 (not 403 — leaking
resource existence is also undesirable).

### Pattern 8: Handler ignores `ErrNotFound` from store Create
Some store Create methods translate FK violations (23503) into `domain.ErrNotFound`, but the
calling handler checked only for `err != nil` → 500. The ErrNotFound never reached the
404 branch.

**Rule:** Every handler calling a store Create method that can return `domain.ErrNotFound`
(i.e., any Create that takes FK arguments) **must** include:
```go
if errors.Is(err, domain.ErrNotFound) {
    respondErr(w, http.StatusNotFound, "NOT_FOUND", "...")
    return
}
```

---

## Test Inventory — Audit Pass 1 (30 tests in `internal/api/projects_backlog_test.go`)

### Projects (8 tests)
- `TestProjects_Create_Success` — POST creates project, returns 201 + id
- `TestProjects_Create_NoAuth` — 401 without token
- `TestProjects_Create_RequiresRole` — 403 for developer role
- `TestProjects_Create_EmptyName` — 400 for empty name
- `TestProjects_Get_Success` — GET returns project JSON
- `TestProjects_Update_InvalidStatus` — 400 for invalid status enum
- `TestProjects_Delete_RequiresAdmin` — 403 for maintainer, 204 for admin
- `TestProjects_Delete_NotFound` — 404 for non-existent project

### Epics (3 tests)
- `TestEpics_Create_Success` — POST creates epic under project
- `TestEpics_Create_ForNonExistentProject` — 404 when project does not exist
- `TestEpics_Create_InvalidStatus` — 400 for invalid epic_status value

### Backlog Items (4 tests)
- `TestBacklog_Create_Success` — POST creates item with default "backlog" status
- `TestBacklog_Create_InvalidStatus` — 400 for invalid item_status
- `TestBacklog_Get_CrossProject` — 404 when item belongs to different project (BUG-06)
- `TestBacklog_Delete_CrossProject` — 404 when item belongs to different project (BUG-07)

### Tasks (3 tests)
- `TestTasks_Create_Success` — POST creates task under backlog item
- `TestTasks_Create_NonExistentItem` — 404 when backlog item does not exist (BUG-17)
- `TestTasks_Delete_NotFound` — 404 for non-existent task

### Sprints (8 tests)
- `TestSprints_Create_Success` — POST creates sprint
- `TestSprints_Create_InvalidDate` — 400 for malformed date string (BUG-11)
- `TestSprints_Update_EmptyName` — 400 for empty name patch (BUG-10)
- `TestSprints_Update_InvalidDate` — 400 for malformed date in update (BUG-11)
- `TestSprints_Delete_NotFound` — 404 for non-existent sprint (BUG-03)
- `TestSprints_AddItem_Success` — POST adds backlog item to sprint
- `TestSprints_AddItem_NotFound` — 404 when sprint or item does not exist (BUG-04)
- `TestSprints_AddItem_Duplicate` — 409 when item already in sprint (BUG-05)

### Comments (5 tests)
- `TestComments_Create_Success` — POST creates comment for backlog item
- `TestComments_Create_WhitespaceBody` — 400 for whitespace-only body (BUG-09)
- `TestComments_Update_Success` — PATCH updates comment body
- `TestComments_SoftDelete_Success` — DELETE soft-deletes comment
- `TestComments_Delete_NotFound` — 404 for non-existent comment

---

## Test Inventory — Audit Pass 2 (18 tests in `internal/api/projects_backlog_test.go`)

### Backlog Items (5 tests)
- `TestBacklog_Create_InvalidType` — 400 for invalid `type` enum (AUDIT-A)
- `TestBacklog_Create_InvalidStatus` — 400 for invalid `status` enum (AUDIT-B)
- `TestBacklog_Update_InvalidStatus` — 400 for invalid `status` on PATCH (AUDIT-B)
- `TestBacklog_Update_CrossProject` — 404 when PATCHing item via wrong project URL (AUDIT-C)
- `TestBacklog_Create_NonExistentProject` — 404 when project does not exist (AUDIT-M/M2)

### Tasks (4 tests)
- `TestTasks_Update_InvalidStatus` — 400 for invalid `status` on PATCH (AUDIT-E)
- `TestTasks_Get_CrossBacklogItem` — 404 when GETting task via wrong backlog item URL (AUDIT-D)
- `TestTasks_Update_CrossBacklogItem` — 404 when PATCHing task via wrong backlog item URL (AUDIT-F)
- `TestTasks_Delete_CrossBacklogItem` — 404 when DELETing task via wrong backlog item URL; original task preserved (AUDIT-G)

### Sprints (4 tests)
- `TestSprints_Create_InvalidStatus` — 400 for invalid `status` on POST (AUDIT-H)
- `TestSprints_Update_InvalidStatus` — 400 for invalid `status` on PATCH (AUDIT-I)
- `TestSprints_Update_InvalidDate` — 400 for malformed `end_date` on PATCH (AUDIT-I)
- `TestSprints_Get_CrossProject` — 404 when GETting sprint via wrong project URL (AUDIT-J)
- `TestSprints_RemoveItem_NotFound` — 404 for DELETE of item not in sprint (AUDIT-O)

### Epics (3 tests)
- `TestEpics_Update_CrossProject` — 404 when PATCHing epic via wrong project URL (AUDIT-K)
- `TestEpics_Delete_CrossProject` — 404 when DELETing epic via wrong project URL; epic preserved (AUDIT-L)
- `TestEpics_Delete_NotFound` — 404 for DELETE of non-existent epic (AUDIT-L store-level)

### Comments (1 test)
- `TestComments_Create_NonExistentItem` — 404 when backlog item does not exist (AUDIT-N/N2)

---

## Files Changed

| File | Change |
|---|---|
| `internal/api/router.go` | Routing fix: moved project CRUD inside `r.Route("/projects/{project_id}", ...)` |
| `internal/api/handler_projects.go` | BUG-01, BUG-12, param rename `id`→`project_id`, added `middleware` import |
| `internal/api/handler_epics.go` | BUG-02, BUG-13, BUG-18b, cross-project Get isolation, added `middleware` import |
| `internal/api/handler_backlog.go` | BUG-18, BUG-06, BUG-07 |
| `internal/api/handler_tasks_sprints.go` | BUG-18c, BUG-03, BUG-04/05, BUG-10, BUG-11, BUG-17, added `time` import |
| `internal/api/handler_comments_capacity.go` | BUG-09, COMMENT-PARENT fix, added `strings` import |
| `internal/db/store/projects.go` | Delete: added GetByID pre-check |
| `internal/db/store/epics.go` | Create: pgconn FK detection; added `pgconn` import |
| `internal/db/store/tasks.go` | Create: pgconn FK detection; Delete: GetByID pre-check; added `pgconn` import |
| `internal/db/store/sprints.go` | Delete: GetByID pre-check; AddItem: pgconn FK+unique detection; added `pgconn` import |
| `internal/db/store/comments.go` | Create: `projectID=""` → NULL; SoftDelete: GetByID pre-check |
| `internal/db/queries/sprints.sql` | Removed `ON CONFLICT DO NOTHING` from AddSprintItem |
| `internal/db/gen/sprints.sql.go` | Same removal in generated file |
| `internal/api/projects_backlog_test.go` | 30 new integration tests (Audit Pass 1) |
| `internal/api/auth_test.go` | seedUser: pre-cleanup now deletes owned projects/items before deleting user |

**Audit Pass 2 additional changes:**

| File | Change |
|---|---|
| `internal/api/handler_backlog.go` | AUDIT-A/B: enum validation maps; AUDIT-C: cross-project isolation in Update; AUDIT-M2: ErrNotFound check in Create |
| `internal/api/handler_tasks_sprints.go` | AUDIT-D: cross-item isolation in Task.Get; AUDIT-E/F: status validation + isolation in Task.Update; AUDIT-G: isolation in Task.Delete; AUDIT-H/I: sprint status validation; AUDIT-J: cross-project isolation in Sprint.Get |
| `internal/api/handler_epics.go` | AUDIT-K: cross-project isolation in Epic.Update; AUDIT-L: pre-fetch + isolation in Epic.Delete |
| `internal/api/handler_comments_capacity.go` | AUDIT-N2: ErrNotFound check in Create |
| `internal/db/store/epics.go` | AUDIT-L: Delete calls GetByID first — no longer silent on 0 rows |
| `internal/db/store/backlog.go` | AUDIT-M: added `pgconn` import; catch 23503 → ErrNotFound in Create |
| `internal/db/store/comments.go` | AUDIT-N: added `pgconn` import; catch 23503 → ErrNotFound in Create |
| `internal/db/store/sprints.go` | AUDIT-O: RemoveItem uses new `:one` generated function; catch ErrNoRows → ErrNotFound |
| `internal/db/queries/sprints.sql` | AUDIT-O: RemoveSprintItem changed from `:exec` to `:one` with `RETURNING sprint_id` |
| `internal/db/gen/sprints.sql.go` | AUDIT-O: hand-edited to use `QueryRow`+`Scan`, return `(pgtype.UUID, error)` |
| `internal/api/projects_backlog_test.go` | 18 new integration tests (Audit Pass 2) |

---

## Test Counts

| Phase | Tests Before | Tests After | Delta |
|---|---|---|---|
| Phase 2 (Auth + Users) | 43 | 43 | 0 |
| Phase 3 (Skills + Teams) | 47 | 47 | 0 |
| Phase 4 Pass 1 (initial feature tests) | 0 | 30 | +30 |
| Phase 4 Pass 2 (audit: isolation + validation + FK) | 120 | 136 | +16 |
| **Total** | **90** | **136** | **+46** |

All 136 tests pass. Zero regressions in Phases 2–3.
