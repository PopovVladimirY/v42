//go:build integration

package api_test

import (
	"net/http"
	"testing"
)

// Cross-project data isolation.
//
// Every nested route carries its full ancestry in the URL. The guards in
// internal/api/guards.go make sure a valid leaf id from project B can't be
// smuggled in under project A. These tests pair an entity from one project with
// another project's path and demand a 404 -- never a 200 that would leak data,
// and never a 403 that would confirm the entity exists.

// isolationFixture spins up two projects owned by the same admin plus a backlog
// item, task and sprint living in projectB. Everything we need to try reaching
// across the fence.
type isolationFixture struct {
	token              string
	ownerID            string
	projectA, projectB string
	itemB, taskB       string
	sprintB            string
}

func newIsolationFixture(t *testing.T) (*testEnv, *isolationFixture) {
	t.Helper()
	e := newTestEnv(t)
	e.seedUser(t, "isolation_admin@test.local", "pw", "admin")
	f := &isolationFixture{
		token:   e.loginToken(t, "isolation_admin@test.local", "pw"),
		ownerID: e.userID(t, "isolation_admin@test.local"),
	}
	f.projectA = e.seedProject(t, f.ownerID)
	f.projectB = e.seedProject(t, f.ownerID)
	f.itemB = e.seedBacklogItem(t, f.projectB, f.ownerID)
	f.taskB = e.seedTask(t, f.itemB, f.ownerID)
	f.sprintB = e.seedSprint(t, f.projectB)
	return e, f
}

func TestIsolation_TaskGet_ForeignProject(t *testing.T) {
	e, f := newIsolationFixture(t)
	// taskB lives under itemB in projectB; ask for it under projectA.
	resp := e.get(t, "/api/v1/projects/"+f.projectA+"/backlog/"+f.itemB+"/tasks/"+f.taskB, f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign-project task Get: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_TaskList_ForeignProject(t *testing.T) {
	e, f := newIsolationFixture(t)
	resp := e.get(t, "/api/v1/projects/"+f.projectA+"/backlog/"+f.itemB+"/tasks", f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign-project task List: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_Comments_ForeignProject(t *testing.T) {
	e, f := newIsolationFixture(t)
	resp := e.get(t, "/api/v1/projects/"+f.projectA+"/backlog/"+f.itemB+"/comments", f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign-project comments List: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_SprintUpdate_ForeignProject(t *testing.T) {
	e, f := newIsolationFixture(t)
	resp := e.patchAuth(t, "/api/v1/projects/"+f.projectA+"/sprints/"+f.sprintB,
		map[string]string{"name": "Hijacked"}, f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign-project sprint Update: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_SprintItems_ForeignProject(t *testing.T) {
	e, f := newIsolationFixture(t)
	resp := e.get(t, "/api/v1/projects/"+f.projectA+"/sprints/"+f.sprintB+"/items", f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("foreign-project sprint ListItems: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_SprintAddItem_ForeignItem(t *testing.T) {
	e, f := newIsolationFixture(t)
	// A legit sprint in projectA, but we try to enroll projectB's item.
	sprintA := e.seedSprint(t, f.projectA)
	resp := e.postAuth(t, "/api/v1/projects/"+f.projectA+"/sprints/"+sprintA+"/items",
		map[string]string{"backlog_item_id": f.itemB}, f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("sprint AddItem with foreign item: expected 404, got %d", resp.StatusCode)
	}
}

func TestIsolation_TaskMove_ForeignTarget(t *testing.T) {
	e, f := newIsolationFixture(t)
	// A legit task in projectA, moved toward projectB's item -- should be refused.
	itemA := e.seedBacklogItem(t, f.projectA, f.ownerID)
	taskA := e.seedTask(t, itemA, f.ownerID)
	resp := e.postAuth(t, "/api/v1/projects/"+f.projectA+"/backlog/"+itemA+"/tasks/"+taskA+"/move",
		map[string]string{"target_item_id": f.itemB}, f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Errorf("task Move to foreign target: expected 404, got %d", resp.StatusCode)
	}
}

// Sanity counter-test: the same operations under the CORRECT project must work,
// so we know the guards reject foreigners without nuking legitimate traffic.
func TestIsolation_TaskGet_OwnProject_OK(t *testing.T) {
	e, f := newIsolationFixture(t)
	resp := e.get(t, "/api/v1/projects/"+f.projectB+"/backlog/"+f.itemB+"/tasks/"+f.taskB, f.token)
	resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Errorf("own-project task Get: expected 200, got %d", resp.StatusCode)
	}
}
