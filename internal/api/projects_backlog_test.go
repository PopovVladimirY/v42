//go:build integration

package api_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

// ─── Seed helpers ────────────────────────────────────────────────────────────
// Direct DB inserts bypass potentially broken POST endpoints. LIFO cleanup via
// t.Cleanup keeps FK ordering safe: children register after parents, so they
// are deleted first.

func (e *testEnv) seedProject(t *testing.T, ownerID string) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO projects (name, status, owner_id)
		 VALUES ('Seed Project', 'active', $1::uuid) RETURNING id::text`,
		ownerID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedProject: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM projects WHERE id = $1::uuid", id)
	})
	return id
}

func (e *testEnv) seedEpic(t *testing.T, projectID, ownerID string) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO epics (project_id, title, status, owner_id)
		 VALUES ($1::uuid, 'Seed Epic', 'draft', $2::uuid) RETURNING id::text`,
		projectID, ownerID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedEpic: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM epics WHERE id = $1::uuid", id)
	})
	return id
}

func (e *testEnv) seedBacklogItem(t *testing.T, projectID, createdBy string) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO backlog_items (project_id, title, type, status, priority, created_by)
		 VALUES ($1::uuid, 'Seed Item', 'story', 'backlog', 0, $2::uuid) RETURNING id::text`,
		projectID, createdBy,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedBacklogItem: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM backlog_items WHERE id = $1::uuid", id)
	})
	return id
}

func (e *testEnv) seedTask(t *testing.T, backlogItemID, createdBy string) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO tasks (backlog_item_id, title, status, order_index, created_by)
		 VALUES ($1::uuid, 'Seed Task', 'todo', 0, $2::uuid) RETURNING id::text`,
		backlogItemID, createdBy,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedTask: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM tasks WHERE id = $1::uuid", id)
	})
	return id
}

func (e *testEnv) seedSprint(t *testing.T, projectID string) string {
	t.Helper()
	var id string
	err := e.pool.QueryRow(context.Background(),
		`INSERT INTO sprints (project_id, name, status)
		 VALUES ($1::uuid, 'Seed Sprint', 'planning') RETURNING id::text`,
		projectID,
	).Scan(&id)
	if err != nil {
		t.Fatalf("seedSprint: %v", err)
	}
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM sprints WHERE id = $1::uuid", id)
	})
	return id
}

// extractID pulls the "id" string from the envelope "data" field.
func extractID(t *testing.T, env map[string]json.RawMessage) string {
	t.Helper()
	var obj struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(env["data"], &obj); err != nil || obj.ID == "" {
		t.Fatalf("extractID: cannot extract id; data=%s", string(env["data"]))
	}
	return obj.ID
}

// ─── Projects ────────────────────────────────────────────────────────────────

// BUG-01: ownerID hardcoded as "" in handler → parseUUID("") → ErrNotFound → 500
func TestProjects_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_create_ok@test.local", "pw", "admin")
	token := e.loginToken(t, "proj_create_ok@test.local", "pw")

	resp := e.postAuth(t, "/api/v1/projects", map[string]string{"name": "Alpha"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("[BUG-01] POST /projects: expected 201, got %d; error=%s", resp.StatusCode, string(env["error"]))
	}
	pid := extractID(t, env)
	if pid == "" {
		t.Fatal("expected non-empty id in response")
	}
	// Cleanup the HTTP-created project so the user FK is free for seedUser cleanup.
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM projects WHERE id = $1::uuid", pid) //nolint:errcheck
	})
}

func TestProjects_Create_NoAuth(t *testing.T) {
	e := newTestEnv(t)
	resp := e.post(t, "/api/v1/projects", map[string]string{"name": "X"})
	resp.Body.Close()
	if resp.StatusCode != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", resp.StatusCode)
	}
}

func TestProjects_Create_RequiresRole(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_dev_role@test.local", "pw", "developer")
	token := e.loginToken(t, "proj_dev_role@test.local", "pw")

	resp := e.postAuth(t, "/api/v1/projects", map[string]string{"name": "X"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 for developer role, got %d", resp.StatusCode)
	}
}

func TestProjects_Create_EmptyName(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_empty_name@test.local", "pw", "admin")
	token := e.loginToken(t, "proj_empty_name@test.local", "pw")

	resp := e.postAuth(t, "/api/v1/projects", map[string]string{"name": ""}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", resp.StatusCode)
	}
}

func TestProjects_Create_WhitespaceName(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_ws_name@test.local", "pw", "admin")
	token := e.loginToken(t, "proj_ws_name@test.local", "pw")

	resp := e.postAuth(t, "/api/v1/projects", map[string]string{"name": "   "}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for whitespace-only name, got %d", resp.StatusCode)
	}
}

func TestProjects_Create_NameTooLong(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_longname@test.local", "pw", "admin")
	token := e.loginToken(t, "proj_longname@test.local", "pw")

	longName := make([]byte, 201)
	for i := range longName {
		longName[i] = 'a'
	}
	resp := e.postAuth(t, "/api/v1/projects", map[string]string{"name": string(longName)}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for name >200 chars, got %d", resp.StatusCode)
	}
}

func TestProjects_List_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_list@test.local", "pw", "developer")
	ownerID := e.userID(t, "proj_list@test.local")
	token := e.loginToken(t, "proj_list@test.local", "pw")
	e.seedProject(t, ownerID)

	resp := e.get(t, "/api/v1/projects", token)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)
	var projects []map[string]json.RawMessage
	json.Unmarshal(env["data"], &projects) //nolint:errcheck
	if len(projects) == 0 {
		t.Error("expected at least one project in list")
	}
}

func TestProjects_Get_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_getnf@test.local", "pw", "developer")
	token := e.loginToken(t, "proj_getnf@test.local", "pw")

	resp := e.get(t, "/api/v1/projects/00000000-0000-0000-0000-000000000000", token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestProjects_Get_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_get_ok@test.local", "pw", "developer")
	ownerID := e.userID(t, "proj_get_ok@test.local")
	token := e.loginToken(t, "proj_get_ok@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.get(t, "/api/v1/projects/"+pid, token)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)
	if extractID(t, env) != pid {
		t.Errorf("expected id=%s in response, got data=%s", pid, string(env["data"]))
	}
}

// BUG-12: invalid status enum → DB constraint fires → 500 instead of 400
func TestProjects_Update_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_upd_status@test.local", "pw", "admin")
	ownerID := e.userID(t, "proj_upd_status@test.local")
	token := e.loginToken(t, "proj_upd_status@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.patchAuth(t, "/api/v1/projects/"+pid, map[string]string{"status": "not_a_real_status"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-12] PATCH /projects/{id} invalid status: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestProjects_Delete_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_delnf@test.local", "pw", "admin")
	token := e.loginToken(t, "proj_delnf@test.local", "pw")

	resp := e.deleteAuth(t, "/api/v1/projects/00000000-0000-0000-0000-000000000000", token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestProjects_Delete_RequiresAdmin(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "proj_del_maint@test.local", "pw", "maintainer")
	token := e.loginToken(t, "proj_del_maint@test.local", "pw")

	resp := e.deleteAuth(t, "/api/v1/projects/00000000-0000-0000-0000-000000000000", token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("expected 403 for maintainer attempting delete, got %d", resp.StatusCode)
	}
}

// ─── Epics ───────────────────────────────────────────────────────────────────

// BUG-02: ownerID hardcoded as "" in epic Create handler → 500 instead of 201
func TestEpics_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_admin@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_admin@test.local")
	token := e.loginToken(t, "epic_admin@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/epics",
		map[string]string{"title": "First Epic"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("[BUG-02] POST /epics: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestEpics_Create_EmptyTitle(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_empty@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_empty@test.local")
	token := e.loginToken(t, "epic_empty@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/epics",
		map[string]string{"title": ""}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty title, got %d", resp.StatusCode)
	}
}

func TestEpics_Create_ForNonExistentProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_noproj@test.local", "pw", "admin")
	token := e.loginToken(t, "epic_noproj@test.local", "pw")

	resp := e.postAuth(t, "/api/v1/projects/00000000-0000-0000-0000-000000000000/epics",
		map[string]string{"title": "X"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404 for non-existent project, got %d", resp.StatusCode)
	}
}

// BUG: epic from project A must not be accessible via project B URL
func TestEpics_Get_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_cross@test.local", "pw", "developer")
	ownerID := e.userID(t, "epic_cross@test.local")
	token := e.loginToken(t, "epic_cross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	epicID := e.seedEpic(t, pid1, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/%s", pid2, epicID), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG] epic cross-project access: expected 404, got %d", resp.StatusCode)
	}
}

// BUG-13: invalid epic status → DB enum constraint → 500 instead of 400
func TestEpics_Update_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_upd@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_upd@test.local")
	token := e.loginToken(t, "epic_upd@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	eid := e.seedEpic(t, pid, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/%s", pid, eid),
		map[string]string{"status": "garbage_status"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-13] PATCH /epics/{id} invalid status: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

// ─── Backlog Items ────────────────────────────────────────────────────────────

func TestBacklog_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_create@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_create@test.local")
	token := e.loginToken(t, "bl_create@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog",
		map[string]any{"title": "My Story", "type": "story"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /backlog: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestBacklog_Create_EmptyTitle(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_empty@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_empty@test.local")
	token := e.loginToken(t, "bl_empty@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog",
		map[string]string{"title": ""}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty title, got %d", resp.StatusCode)
	}
}

func TestBacklog_Create_WhitespaceTitle(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_ws@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_ws@test.local")
	token := e.loginToken(t, "bl_ws@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog",
		map[string]string{"title": "   "}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for whitespace-only title, got %d", resp.StatusCode)
	}
}

func TestBacklog_Get_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_get@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_get@test.local")
	token := e.loginToken(t, "bl_get@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid, bid), token)
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)
	if extractID(t, env) != bid {
		t.Errorf("expected item id=%s, got data=%s", bid, string(env["data"]))
	}
}

func TestBacklog_Get_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_getnf@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_getnf@test.local")
	token := e.loginToken(t, "bl_getnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/00000000-0000-0000-0000-000000000000", pid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

// BUG-06: GET /projects/{project_id}/backlog/{id} lacks cross-project validation
func TestBacklog_Get_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_cross@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_cross@test.local")
	token := e.loginToken(t, "bl_cross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid1, ownerID)

	// Access pid1's item via pid2 URL — must be 404
	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid2, bid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG-06] backlog cross-project GET: expected 404, got %d", resp.StatusCode)
	}
}

// BUG-07: DELETE /projects/{project_id}/backlog/{id} lacks cross-project validation
func TestBacklog_Delete_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_del_cross@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_del_cross@test.local")
	token := e.loginToken(t, "bl_del_cross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid1, ownerID)

	// Attempt to delete pid1's item via pid2 URL — must be 404
	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid2, bid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG-07] backlog cross-project DELETE: expected 404, got %d", resp.StatusCode)
	}

	// Confirm the item still exists in its real project
	resp2 := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid1, bid), token)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Error("item should still be accessible in original project after failed cross-project delete")
	}
}

func TestBacklog_Reorder_EmptyItems(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_reord@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_reord@test.local")
	token := e.loginToken(t, "bl_reord@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog/reorder",
		map[string]any{"items": []any{}}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty reorder items, got %d", resp.StatusCode)
	}
}

// ─── Tasks ───────────────────────────────────────────────────────────────────

func TestTasks_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_create@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_create@test.local")
	token := e.loginToken(t, "task_create@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks", pid, bid),
		map[string]string{"title": "Write tests"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /tasks: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestTasks_Create_EmptyTitle(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_empty@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_empty@test.local")
	token := e.loginToken(t, "task_empty@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks", pid, bid),
		map[string]string{"title": ""}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty title, got %d", resp.StatusCode)
	}
}

// BUG-17: task Create on non-existent backlog item → FK violation → 500 not 404
func TestTasks_Create_NonExistentBacklogItem(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_nobid@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_nobid@test.local")
	token := e.loginToken(t, "task_nobid@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/00000000-0000-0000-0000-000000000000/tasks", pid),
		map[string]string{"title": "orphan"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG-17] task Create on missing backlog item: expected 404, got %d", resp.StatusCode)
	}
}

func TestTasks_Delete_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_delnf@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_delnf@test.local")
	token := e.loginToken(t, "task_delnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/00000000-0000-0000-0000-000000000000", pid, bid),
		token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

func TestTasks_Get_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_getnf@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_getnf@test.local")
	token := e.loginToken(t, "task_getnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/00000000-0000-0000-0000-000000000000", pid, bid),
		token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

// ─── Sprints ─────────────────────────────────────────────────────────────────

func TestSprints_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_create@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_create@test.local")
	token := e.loginToken(t, "spr_create@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/sprints",
		map[string]string{"name": "Sprint 1"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /sprints: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestSprints_Create_EmptyName(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_noname@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_noname@test.local")
	token := e.loginToken(t, "spr_noname@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/sprints",
		map[string]string{"name": ""}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("expected 400 for empty name, got %d", resp.StatusCode)
	}
}

// BUG-11: invalid date string → pgtype.Date.Scan error → raw error passed up → 500 not 400
func TestSprints_Create_InvalidDate(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_baddate@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_baddate@test.local")
	token := e.loginToken(t, "spr_baddate@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/sprints",
		map[string]string{"name": "Sprint X", "start_date": "not-a-date"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-11] POST sprint invalid date: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestSprints_Get_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_getnf@test.local", "pw", "developer")
	ownerID := e.userID(t, "spr_getnf@test.local")
	token := e.loginToken(t, "spr_getnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/00000000-0000-0000-0000-000000000000", pid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

// BUG-03: sprintHandlers.Delete has no ErrNotFound check → 500 not 404
func TestSprints_Delete_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_delnf@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_delnf@test.local")
	token := e.loginToken(t, "spr_delnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/00000000-0000-0000-0000-000000000000", pid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG-03] DELETE sprint not found: expected 404, got %d", resp.StatusCode)
	}
}

// BUG-10: Sprint Update handler passes name through without TrimSpace/empty check
func TestSprints_Update_EmptyName(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_updname@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_updname@test.local")
	token := e.loginToken(t, "spr_updname@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s", pid, sid),
		map[string]string{"name": ""}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-10] PATCH sprint empty name: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

// BUG-04: AddItem no error-type checking → 500 for non-existent sprint (FK violation)
func TestSprints_AddItem_NonExistentSprint(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_add_nospr@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_add_nospr@test.local")
	token := e.loginToken(t, "spr_add_nospr@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/00000000-0000-0000-0000-000000000000/items", pid),
		map[string]string{"backlog_item_id": bid}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("[BUG-04] AddItem non-existent sprint: expected 404, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestSprints_AddAndRemoveItem_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_items@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_items@test.local")
	token := e.loginToken(t, "spr_items@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)
	bid := e.seedBacklogItem(t, pid, ownerID)

	addPath := fmt.Sprintf("/api/v1/projects/%s/sprints/%s/items", pid, sid)

	// Add item to sprint
	resp := e.postAuth(t, addPath, map[string]string{"backlog_item_id": bid}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("AddItem: expected 204, got %d", resp.StatusCode)
	}

	// List sprint items
	resp = e.get(t, fmt.Sprintf("/api/v1/projects/%s/sprints/%s/items", pid, sid), token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("ListItems: expected 200, got %d", resp.StatusCode)
	}
	var items []map[string]json.RawMessage
	json.Unmarshal(env["data"], &items) //nolint:errcheck
	if len(items) != 1 {
		t.Errorf("expected 1 sprint item, got %d", len(items))
	}

	// Remove item
	resp = e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s/items/%s", pid, sid, bid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("RemoveItem: expected 204, got %d", resp.StatusCode)
	}
}

// BUG-05: AddItem duplicate → unique constraint violation → 500 instead of 409
func TestSprints_AddItem_Duplicate(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_dup@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_dup@test.local")
	token := e.loginToken(t, "spr_dup@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)
	bid := e.seedBacklogItem(t, pid, ownerID)

	// Ensure sprint_items row is removed before backlog_item is deleted (FK safety)
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), //nolint:errcheck
			"DELETE FROM sprint_items WHERE sprint_id = $1::uuid AND backlog_item_id = $2::uuid",
			sid, bid)
	})

	addPath := fmt.Sprintf("/api/v1/projects/%s/sprints/%s/items", pid, sid)
	body := map[string]string{"backlog_item_id": bid}

	resp := e.postAuth(t, addPath, body, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("first AddItem should return 204, got %d", resp.StatusCode)
	}

	// Second add must return 409 Conflict
	resp = e.postAuth(t, addPath, body, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusConflict {
		t.Errorf("[BUG-05] AddItem duplicate: expected 409, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

// ─── Comments ────────────────────────────────────────────────────────────────

func TestComments_Create_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_create@test.local", "pw", "developer")
	ownerID := e.userID(t, "cmt_create@test.local")
	token := e.loginToken(t, "cmt_create@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/comments", pid, bid),
		map[string]string{"body": "Looks good to me"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("POST /comments: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

// BUG-09: body "   " passes `== ""` check without TrimSpace → 201 not 400
func TestComments_Create_WhitespaceBody(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_ws@test.local", "pw", "developer")
	ownerID := e.userID(t, "cmt_ws@test.local")
	token := e.loginToken(t, "cmt_ws@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/comments", pid, bid),
		map[string]string{"body": "   "}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-09] comment whitespace body: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestComments_Update_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_upd@test.local", "pw", "developer")
	ownerID := e.userID(t, "cmt_upd@test.local")
	token := e.loginToken(t, "cmt_upd@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	// Create a comment (will fail if BUG-09 is not the only issue)
	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/comments", pid, bid),
		map[string]string{"body": "Initial body"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create comment: expected 201, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
	cmtID := extractID(t, env)

	// Update
	resp = e.patchAuth(t, "/api/v1/comments/"+cmtID,
		map[string]string{"body": "Updated body"}, token)
	env = decodeBody(t, resp)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("PATCH /comments/{id}: expected 200, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

func TestComments_SoftDelete_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_del@test.local", "pw", "developer")
	ownerID := e.userID(t, "cmt_del@test.local")
	token := e.loginToken(t, "cmt_del@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/comments", pid, bid),
		map[string]string{"body": "Delete me"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create comment: expected 201, got %d", resp.StatusCode)
	}
	cmtID := extractID(t, env)

	resp = e.deleteAuth(t, "/api/v1/comments/"+cmtID, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Errorf("DELETE /comments/{id}: expected 204, got %d", resp.StatusCode)
	}
}

func TestComments_Delete_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_delnf@test.local", "pw", "developer")
	token := e.loginToken(t, "cmt_delnf@test.local", "pw")

	resp := e.deleteAuth(t, "/api/v1/comments/00000000-0000-0000-0000-000000000000", token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("expected 404, got %d", resp.StatusCode)
	}
}

// ─── Audit Pass 2: new tests for previously untested code paths ───────────────

// Backlog Create: invalid type enum → 500 without validation, now 400
func TestBacklog_Create_InvalidType(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_type@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_type@test.local")
	token := e.loginToken(t, "bl_type@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog",
		map[string]any{"title": "X", "type": "garbage_type"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("backlog Create invalid type: expected 400, got %d", resp.StatusCode)
	}
}

// Backlog Create: invalid status enum → 500 without validation, now 400
func TestBacklog_Create_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_crstatus@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_crstatus@test.local")
	token := e.loginToken(t, "bl_crstatus@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/backlog",
		map[string]any{"title": "X", "status": "not_a_real_status"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("backlog Create invalid status: expected 400, got %d", resp.StatusCode)
	}
}

// Backlog Update: invalid status → DB enum → 500 not 400
func TestBacklog_Update_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_updst@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_updst@test.local")
	token := e.loginToken(t, "bl_updst@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid, bid),
		map[string]string{"status": "not_a_real_status"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("backlog Update invalid status: expected 400, got %d", resp.StatusCode)
	}
}

// Backlog Update: cross-project isolation — PATCH pid2/backlog/item-from-pid1 must 404
func TestBacklog_Update_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_updcross@test.local", "pw", "developer")
	ownerID := e.userID(t, "bl_updcross@test.local")
	token := e.loginToken(t, "bl_updcross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid1, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s", pid2, bid),
		map[string]string{"title": "hacked"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("backlog Update cross-project: expected 404, got %d", resp.StatusCode)
	}
}

// Backlog Create on non-existent project → FK violation → 500 not 404
func TestBacklog_Create_NonExistentProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "bl_crproj@test.local", "pw", "developer")
	token := e.loginToken(t, "bl_crproj@test.local", "pw")

	resp := e.postAuth(t,
		"/api/v1/projects/00000000-0000-0000-0000-000000000000/backlog",
		map[string]any{"title": "X"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("backlog Create non-existent project: expected 404, got %d", resp.StatusCode)
	}
}

// Task Update: invalid status → DB enum → 500 not 400
func TestTasks_Update_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_updst@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_updst@test.local")
	token := e.loginToken(t, "task_updst@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid := e.seedBacklogItem(t, pid, ownerID)
	tid := e.seedTask(t, bid, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/%s", pid, bid, tid),
		map[string]string{"status": "garbage"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("task Update invalid status: expected 400, got %d", resp.StatusCode)
	}
}

// Task Get: cross-backlog-item isolation — task from bid1 accessed via bid2 must 404
func TestTasks_Get_CrossBacklogItem(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_getcross@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_getcross@test.local")
	token := e.loginToken(t, "task_getcross@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid1 := e.seedBacklogItem(t, pid, ownerID)
	bid2 := e.seedBacklogItem(t, pid, ownerID)
	tid := e.seedTask(t, bid1, ownerID)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/%s", pid, bid2, tid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("task Get cross-backlog-item: expected 404, got %d", resp.StatusCode)
	}
}

// Task Update: cross-backlog-item isolation
func TestTasks_Update_CrossBacklogItem(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_updcross@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_updcross@test.local")
	token := e.loginToken(t, "task_updcross@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid1 := e.seedBacklogItem(t, pid, ownerID)
	bid2 := e.seedBacklogItem(t, pid, ownerID)
	tid := e.seedTask(t, bid1, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/%s", pid, bid2, tid),
		map[string]string{"title": "hacked"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("task Update cross-backlog-item: expected 404, got %d", resp.StatusCode)
	}
}

// Task Delete: cross-backlog-item isolation
func TestTasks_Delete_CrossBacklogItem(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "task_delcross@test.local", "pw", "developer")
	ownerID := e.userID(t, "task_delcross@test.local")
	token := e.loginToken(t, "task_delcross@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	bid1 := e.seedBacklogItem(t, pid, ownerID)
	bid2 := e.seedBacklogItem(t, pid, ownerID)
	tid := e.seedTask(t, bid1, ownerID)

	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/%s", pid, bid2, tid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("task Delete cross-backlog-item: expected 404, got %d", resp.StatusCode)
	}

	// Verify task still exists in its real backlog item
	resp2 := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/%s/tasks/%s", pid, bid1, tid), token)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Error("task should still be accessible after failed cross-backlog-item delete")
	}
}

// Sprint Create: invalid status → DB enum → 500 not 400
func TestSprints_Create_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_crstatus@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_crstatus@test.local")
	token := e.loginToken(t, "spr_crstatus@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t, "/api/v1/projects/"+pid+"/sprints",
		map[string]string{"name": "Sprint X", "status": "garbage"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("sprint Create invalid status: expected 400, got %d", resp.StatusCode)
	}
}

// Sprint Update: invalid status
func TestSprints_Update_InvalidStatus(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_updst@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_updst@test.local")
	token := e.loginToken(t, "spr_updst@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s", pid, sid),
		map[string]string{"status": "garbage"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("sprint Update invalid status: expected 400, got %d", resp.StatusCode)
	}
}

// Sprint Update: invalid date in update
func TestSprints_Update_InvalidDate(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_upddate@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_upddate@test.local")
	token := e.loginToken(t, "spr_upddate@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s", pid, sid),
		map[string]string{"end_date": "not-a-date"}, token)
	env := decodeBody(t, resp)
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("[BUG-11] PATCH sprint invalid date: expected 400, got %d; error=%s",
			resp.StatusCode, string(env["error"]))
	}
}

// Sprint Get: cross-project isolation — sprint from project A accessed via project B must 404
func TestSprints_Get_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_getcross@test.local", "pw", "developer")
	ownerID := e.userID(t, "spr_getcross@test.local")
	token := e.loginToken(t, "spr_getcross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid1)

	resp := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s", pid2, sid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("sprint Get cross-project: expected 404, got %d", resp.StatusCode)
	}
}

// Sprint RemoveItem: 204 for item not in sprint (should be 404)
func TestSprints_RemoveItem_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "spr_remnf@test.local", "pw", "admin")
	ownerID := e.userID(t, "spr_remnf@test.local")
	token := e.loginToken(t, "spr_remnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)
	sid := e.seedSprint(t, pid)
	bid := e.seedBacklogItem(t, pid, ownerID)

	// Remove item that was never added — must be 404, not 204
	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/sprints/%s/items/%s", pid, sid, bid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("sprint RemoveItem not-in-sprint: expected 404, got %d", resp.StatusCode)
	}
}

// Epic Update: cross-project isolation
func TestEpics_Update_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_updcross@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_updcross@test.local")
	token := e.loginToken(t, "epic_updcross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	eid := e.seedEpic(t, pid1, ownerID)

	resp := e.patchAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/%s", pid2, eid),
		map[string]string{"title": "hacked"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("epic Update cross-project: expected 404, got %d", resp.StatusCode)
	}
}

// Epic Delete: cross-project isolation
func TestEpics_Delete_CrossProject(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_delcross@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_delcross@test.local")
	token := e.loginToken(t, "epic_delcross@test.local", "pw")
	pid1 := e.seedProject(t, ownerID)
	pid2 := e.seedProject(t, ownerID)
	eid := e.seedEpic(t, pid1, ownerID)

	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/%s", pid2, eid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("epic Delete cross-project: expected 404, got %d", resp.StatusCode)
	}

	// Verify epic still exists in its real project
	resp2 := e.get(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/%s", pid1, eid), token)
	resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		t.Error("epic should still be accessible after failed cross-project delete")
	}
}

// Epic Delete: 404 for non-existent epic (store was silently returning nil for 0 rows)
func TestEpics_Delete_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "epic_delnf@test.local", "pw", "admin")
	ownerID := e.userID(t, "epic_delnf@test.local")
	token := e.loginToken(t, "epic_delnf@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.deleteAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/epics/00000000-0000-0000-0000-000000000000", pid), token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("epic Delete not found: expected 404, got %d", resp.StatusCode)
	}
}

// Comments Create: non-existent backlog item → FK violation → 500 not 404
func TestComments_Create_NonExistentItem(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cmt_noitem@test.local", "pw", "developer")
	ownerID := e.userID(t, "cmt_noitem@test.local")
	token := e.loginToken(t, "cmt_noitem@test.local", "pw")
	pid := e.seedProject(t, ownerID)

	resp := e.postAuth(t,
		fmt.Sprintf("/api/v1/projects/%s/backlog/00000000-0000-0000-0000-000000000000/comments", pid),
		map[string]string{"body": "hello"}, token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("comment Create non-existent item: expected 404, got %d", resp.StatusCode)
	}
}
