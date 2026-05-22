//go:build integration

package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/vpo/v42/internal/domain"
)

// -- Phase 3 HTTP helpers (extend testEnv from auth_test.go) -----------------

// loginToken logs in and returns the access token. Cookies go to the shared jar.
func (e *testEnv) loginToken(t *testing.T, email, password string) string {
	t.Helper()
	resp := e.post(t, "/api/v1/auth/login", map[string]string{"email": email, "password": password})
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		t.Fatalf("loginToken %s: expected 200, got %d", email, resp.StatusCode)
	}
	env := decodeBody(t, resp)
	var data struct {
		AccessToken string `json:"access_token"`
	}
	json.Unmarshal(env["data"], &data) //nolint:errcheck
	if data.AccessToken == "" {
		t.Fatalf("loginToken %s: empty access_token", email)
	}
	return data.AccessToken
}

// postAuth sends POST with JSON body and Bearer token.
func (e *testEnv) postAuth(t *testing.T, path string, body any, token string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	return resp
}

// patchAuth sends PATCH with JSON body and Bearer token.
func (e *testEnv) patchAuth(t *testing.T, path string, body any, token string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPatch, e.srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("PATCH %s: %v", path, err)
	}
	return resp
}

// putAuth sends PUT with JSON body and Bearer token.
func (e *testEnv) putAuth(t *testing.T, path string, body any, token string) *http.Response {
	t.Helper()
	b, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPut, e.srv.URL+path, bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("PUT %s: %v", path, err)
	}
	return resp
}

// deleteAuth sends DELETE with Bearer token.
func (e *testEnv) deleteAuth(t *testing.T, path, token string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodDelete, e.srv.URL+path, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("DELETE %s: %v", path, err)
	}
	return resp
}

// makeReq sends any HTTP method with optional JSON body and Bearer token.
// body may be nil for GET/DELETE.
func (e *testEnv) makeReq(t *testing.T, method, path string, body any, token string) *http.Response {
	t.Helper()
	var bodyReader *bytes.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		bodyReader = bytes.NewReader(b)
	} else {
		bodyReader = bytes.NewReader(nil)
	}
	req, _ := http.NewRequest(method, e.srv.URL+path, bodyReader)
	req.Header.Set("Authorization", "Bearer "+token)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

// userID fetches the UUID string of a seeded user by email.
func (e *testEnv) userID(t *testing.T, email string) string {
	t.Helper()
	row, err := e.q.GetUserByEmail(context.Background(), email)
	if err != nil {
		t.Fatalf("userID %s: %v", email, err)
	}
	b := row.ID.Bytes
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// -- Users -------------------------------------------------------------------

func TestUsers_List_AsAdmin(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_list@test.local", "pass1", "admin")
	e.seedUser(t, "inactive_list@test.local", "pass2", "developer")
	// Deactivate second user.
	e.pool.Exec(context.Background(), "UPDATE users SET is_active = false WHERE email = $1", "inactive_list@test.local") //nolint:errcheck

	token := e.loginToken(t, "admin_list@test.local", "pass1")
	resp := e.get(t, "/api/v1/users", token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var users []domain.User
	json.Unmarshal(env["data"], &users) //nolint:errcheck

	// Admin must see at least 2 users including the inactive one.
	foundInactive := false
	for _, u := range users {
		if u.Email == "inactive_list@test.local" {
			foundInactive = true
		}
	}
	if !foundInactive {
		t.Error("admin should see inactive users in list")
	}
}

func TestUsers_List_AsDeveloper_HidesInactive(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_list@test.local", "pass1", "developer")
	e.seedUser(t, "hidden_list@test.local", "pass2", "developer")
	e.pool.Exec(context.Background(), "UPDATE users SET is_active = false WHERE email = $1", "hidden_list@test.local") //nolint:errcheck

	token := e.loginToken(t, "dev_list@test.local", "pass1")
	resp := e.get(t, "/api/v1/users", token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var users []domain.User
	json.Unmarshal(env["data"], &users) //nolint:errcheck

	for _, u := range users {
		if !u.IsActive {
			t.Errorf("developer should not see inactive user %s", u.Email)
		}
	}
}

func TestUsers_Get_Success(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "getme@test.local", "passpass", "developer")

	token := e.loginToken(t, "getme@test.local", "passpass")
	id := e.userID(t, "getme@test.local")

	resp := e.get(t, "/api/v1/users/"+id, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var user domain.User
	json.Unmarshal(env["data"], &user) //nolint:errcheck

	if user.Email != "getme@test.local" {
		t.Errorf("expected email getme@test.local, got %q", user.Email)
	}
	if user.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}
}

func TestUsers_Get_NotFound(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "finder@test.local", "pass", "developer")
	token := e.loginToken(t, "finder@test.local", "pass")

	resp := e.get(t, "/api/v1/users/00000000-0000-0000-0000-000000000000", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for unknown user, got %d", resp.StatusCode)
	}
}

func TestUsers_Update_OwnProfile(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "selfpatch@test.local", "pass", "developer")

	token := e.loginToken(t, "selfpatch@test.local", "pass")
	id := e.userID(t, "selfpatch@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+id, map[string]string{"display_name": "New Name"}, token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var user domain.User
	json.Unmarshal(env["data"], &user) //nolint:errcheck

	if user.DisplayName != "New Name" {
		t.Errorf("expected display_name 'New Name', got %q", user.DisplayName)
	}
}

func TestUsers_Update_RoleByAdmin(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "role_admin@test.local", "pass", "admin")
	e.seedUser(t, "role_target@test.local", "pass", "developer")

	adminToken := e.loginToken(t, "role_admin@test.local", "pass")
	targetID := e.userID(t, "role_target@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+targetID, map[string]string{"role": "tester"}, adminToken)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var user domain.User
	json.Unmarshal(env["data"], &user) //nolint:errcheck

	if user.Role != "tester" {
		t.Errorf("expected role 'tester', got %q", user.Role)
	}
}

func TestUsers_Update_RoleByNonAdmin_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "norole_dev@test.local", "pass", "developer")
	e.seedUser(t, "norole_target@test.local", "pass", "developer")

	devToken := e.loginToken(t, "norole_dev@test.local", "pass")
	targetID := e.userID(t, "norole_target@test.local")

	// Try to escalate target's role -- must be forbidden.
	resp := e.patchAuth(t, "/api/v1/users/"+targetID, map[string]string{"role": "admin"}, devToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestUsers_Update_OtherUser_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "other_dev@test.local", "pass", "developer")
	e.seedUser(t, "other_target@test.local", "pass", "developer")

	devToken := e.loginToken(t, "other_dev@test.local", "pass")
	targetID := e.userID(t, "other_target@test.local")

	// Non-admin trying to edit another user's profile.
	resp := e.patchAuth(t, "/api/v1/users/"+targetID, map[string]string{"display_name": "Hacked"}, devToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

// -- Skills ------------------------------------------------------------------

func TestSkills_List(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "skill_reader@test.local", "pass", "developer")

	token := e.loginToken(t, "skill_reader@test.local", "pass")
	resp := e.get(t, "/api/v1/skills", token)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var skills []map[string]any
	json.Unmarshal(env["data"], &skills) //nolint:errcheck

	// Migration 000004 seeds 30 builtin skills; must have at least some.
	if len(skills) < 5 {
		t.Errorf("expected at least 5 builtin skills, got %d", len(skills))
	}
	// Verify schema: each skill must have id, name, is_builtin.
	if skills[0]["id"] == nil || skills[0]["name"] == nil {
		t.Error("skill missing required fields (id, name)")
	}
}

func TestSkills_Create_AsAdmin(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "skill_admin@test.local", "pass", "admin")

	token := e.loginToken(t, "skill_admin@test.local", "pass")

	skillName := "Fortran" // retro, but valid
	resp := e.postAuth(t, "/api/v1/skills", map[string]string{"name": skillName, "category": "Backend"}, token)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201, got %d", resp.StatusCode)
	}
	env := decodeBody(t, resp)

	var skill map[string]any
	json.Unmarshal(env["data"], &skill) //nolint:errcheck

	if skill["name"] != skillName {
		t.Errorf("expected name %q, got %v", skillName, skill["name"])
	}
	if skill["is_builtin"] != false {
		t.Error("custom skill must have is_builtin = false")
	}
	// Cleanup.
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM skills WHERE name = $1", skillName) //nolint:errcheck
	})
}

func TestSkills_Create_AsDeveloper_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "skill_dev@test.local", "pass", "developer")

	token := e.loginToken(t, "skill_dev@test.local", "pass")
	resp := e.postAuth(t, "/api/v1/skills", map[string]string{"name": "ForbiddenSkill"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestSkills_Create_Duplicate_Conflict(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "skill_dup@test.local", "pass", "admin")

	token := e.loginToken(t, "skill_dup@test.local", "pass")

	// Create once.
	resp1 := e.postAuth(t, "/api/v1/skills", map[string]string{"name": "UniqueSkillXYZ"}, token)
	resp1.Body.Close()
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM skills WHERE name = 'UniqueSkillXYZ'") //nolint:errcheck
	})

	// Create again -- must conflict.
	resp2 := e.postAuth(t, "/api/v1/skills", map[string]string{"name": "UniqueSkillXYZ"}, token)
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusConflict {
		t.Fatalf("expected 409 for duplicate skill, got %d", resp2.StatusCode)
	}
}

func TestMemberSkills_UpsertAndList(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "ms_user@test.local", "pass", "developer")

	token := e.loginToken(t, "ms_user@test.local", "pass")
	id := e.userID(t, "ms_user@test.local")

	// Find the "Go" builtin skill ID.
	var goSkillID string
	{
		resp := e.get(t, "/api/v1/skills", token)
		env := decodeBody(t, resp)
		var skills []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		json.Unmarshal(env["data"], &skills) //nolint:errcheck
		for _, s := range skills {
			if s.Name == "Go" {
				goSkillID = s.ID
				break
			}
		}
	}
	if goSkillID == "" {
		t.Fatal("Go skill not found in catalog (migration 000004 must be applied)")
	}

	// Add skill to profile.
	upsertResp := e.putAuth(t, "/api/v1/users/"+id+"/skills/"+goSkillID,
		map[string]string{"level": "proficient", "interest": "high"}, token)
	if upsertResp.StatusCode != http.StatusOK {
		t.Fatalf("upsert skill: expected 200, got %d", upsertResp.StatusCode)
	}
	upsertResp.Body.Close()
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM member_skills WHERE user_id = (SELECT id FROM users WHERE email = 'ms_user@test.local')") //nolint:errcheck
	})

	// List user's skills.
	listResp := e.get(t, "/api/v1/users/"+id+"/skills", token)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list skills: expected 200, got %d", listResp.StatusCode)
	}
	env := decodeBody(t, listResp)

	var memberSkills []struct {
		SkillName string `json:"skill_name"`
		Level     string `json:"level"`
		Interest  string `json:"interest"`
	}
	json.Unmarshal(env["data"], &memberSkills) //nolint:errcheck

	if len(memberSkills) != 1 {
		t.Fatalf("expected 1 member skill, got %d", len(memberSkills))
	}
	if memberSkills[0].SkillName != "Go" {
		t.Errorf("expected skill_name 'Go', got %q", memberSkills[0].SkillName)
	}
	if memberSkills[0].Level != "proficient" {
		t.Errorf("expected level 'proficient', got %q", memberSkills[0].Level)
	}
}

func TestMemberSkills_OtherUser_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "ms_owner@test.local", "pass", "developer")
	e.seedUser(t, "ms_intruder@test.local", "pass", "developer")

	intruderToken := e.loginToken(t, "ms_intruder@test.local", "pass")
	ownerID := e.userID(t, "ms_owner@test.local")

	// Get a skill ID to use.
	resp := e.get(t, "/api/v1/skills", intruderToken)
	env := decodeBody(t, resp)
	var skills []struct {
		ID string `json:"id"`
	}
	json.Unmarshal(env["data"], &skills) //nolint:errcheck
	if len(skills) == 0 {
		t.Fatal("no skills in catalog")
	}

	// Intruder tries to add skill to owner's profile.
	putResp := e.putAuth(t, "/api/v1/users/"+ownerID+"/skills/"+skills[0].ID,
		map[string]string{"level": "expert", "interest": "high"}, intruderToken)
	defer putResp.Body.Close()
	if putResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", putResp.StatusCode)
	}
}

// -- Teams -------------------------------------------------------------------

func TestTeams_CreateAndList(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "team_maint@test.local", "pass", "maintainer")

	token := e.loginToken(t, "team_maint@test.local", "pass")

	// Create a team.
	desc := "We build things"
	resp := e.postAuth(t, "/api/v1/teams", map[string]any{
		"name": "Omega Squad", "description": desc,
	}, token)
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("create team: expected 201, got %d", resp.StatusCode)
	}
	createEnv := decodeBody(t, resp)

	var created struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	json.Unmarshal(createEnv["data"], &created) //nolint:errcheck
	if created.Name != "Omega Squad" {
		t.Errorf("expected name 'Omega Squad', got %q", created.Name)
	}

	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", created.ID) //nolint:errcheck
	})

	// List teams -- must include the newly created one.
	listResp := e.get(t, "/api/v1/teams", token)
	if listResp.StatusCode != http.StatusOK {
		t.Fatalf("list teams: expected 200, got %d", listResp.StatusCode)
	}
	listEnv := decodeBody(t, listResp)

	var teams []struct{ Name string `json:"name"` }
	json.Unmarshal(listEnv["data"], &teams) //nolint:errcheck

	found := false
	for _, tm := range teams {
		if tm.Name == "Omega Squad" {
			found = true
		}
	}
	if !found {
		t.Error("newly created team not found in list")
	}
}

func TestTeams_Create_AsDeveloper_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "team_dev@test.local", "pass", "developer")

	token := e.loginToken(t, "team_dev@test.local", "pass")
	resp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Forbidden Team"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", resp.StatusCode)
	}
}

func TestTeams_GetWithMembers(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "teamget_admin@test.local", "pass", "admin")
	e.seedUser(t, "teamget_member@test.local", "pass", "developer")

	adminToken := e.loginToken(t, "teamget_admin@test.local", "pass")
	memberID := e.userID(t, "teamget_member@test.local")

	// Create team.
	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Get Test Team"}, adminToken)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", team.ID) //nolint:errcheck
	})

	// Add member.
	addResp := e.postAuth(t, "/api/v1/teams/"+team.ID+"/members",
		map[string]any{"user_id": memberID, "capacity_hours": 24}, adminToken)
	if addResp.StatusCode != http.StatusOK {
		t.Fatalf("add member: expected 200, got %d", addResp.StatusCode)
	}
	addResp.Body.Close()

	// Get team with members.
	getResp := e.get(t, "/api/v1/teams/"+team.ID, adminToken)
	if getResp.StatusCode != http.StatusOK {
		t.Fatalf("get team: expected 200, got %d", getResp.StatusCode)
	}
	getEnv := decodeBody(t, getResp)

	var teamWithMembers struct {
		Name    string `json:"name"`
		Members []struct {
			UserID        string `json:"user_id"`
			CapacityHours int    `json:"capacity_hours"`
		} `json:"members"`
	}
	json.Unmarshal(getEnv["data"], &teamWithMembers) //nolint:errcheck

	if teamWithMembers.Name != "Get Test Team" {
		t.Errorf("expected name 'Get Test Team', got %q", teamWithMembers.Name)
	}
	if len(teamWithMembers.Members) != 1 {
		t.Fatalf("expected 1 member, got %d", len(teamWithMembers.Members))
	}
	if teamWithMembers.Members[0].UserID != memberID {
		t.Errorf("expected member %s, got %s", memberID, teamWithMembers.Members[0].UserID)
	}
	if teamWithMembers.Members[0].CapacityHours != 24 {
		t.Errorf("expected capacity_hours 24, got %d", teamWithMembers.Members[0].CapacityHours)
	}
}

func TestTeams_Update(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "teamupd_admin@test.local", "pass", "admin")

	token := e.loginToken(t, "teamupd_admin@test.local", "pass")

	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Old Name"}, token)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", team.ID) //nolint:errcheck
	})

	patchResp := e.patchAuth(t, "/api/v1/teams/"+team.ID, map[string]any{"name": "New Name"}, token)
	if patchResp.StatusCode != http.StatusOK {
		t.Fatalf("update team: expected 200, got %d", patchResp.StatusCode)
	}
	patchEnv := decodeBody(t, patchResp)

	var updated struct{ Name string `json:"name"` }
	json.Unmarshal(patchEnv["data"], &updated) //nolint:errcheck

	if updated.Name != "New Name" {
		t.Errorf("expected 'New Name', got %q", updated.Name)
	}
}

func TestTeams_Delete_AsAdmin(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "teamdel_admin@test.local", "pass", "admin")

	token := e.loginToken(t, "teamdel_admin@test.local", "pass")

	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Doomed Team"}, token)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck

	delResp := e.deleteAuth(t, "/api/v1/teams/"+team.ID, token)
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusNoContent {
		t.Fatalf("delete team: expected 204, got %d", delResp.StatusCode)
	}

	// Verify it's gone.
	getResp := e.get(t, "/api/v1/teams/"+team.ID, token)
	defer getResp.Body.Close()
	if getResp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 after delete, got %d", getResp.StatusCode)
	}
}

func TestTeams_Delete_AsMaintainer_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "teamdel_maint@test.local", "pass", "maintainer")
	e.seedUser(t, "teamdel_adm2@test.local", "pass", "admin")

	maintToken := e.loginToken(t, "teamdel_maint@test.local", "pass")
	adminToken := e.loginToken(t, "teamdel_adm2@test.local", "pass")

	// Admin creates team, maintainer tries to delete.
	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Protected Team"}, adminToken)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", team.ID) //nolint:errcheck
	})

	delResp := e.deleteAuth(t, "/api/v1/teams/"+team.ID, maintToken)
	defer delResp.Body.Close()
	if delResp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for maintainer delete, got %d", delResp.StatusCode)
	}
}

// RequireRole integration test: first protected route confirms middleware works end-to-end.
func TestRequireRole_Integration(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "role_obs@test.local", "pass", "observer")

	token := e.loginToken(t, "role_obs@test.local", "pass")

	// Observer cannot create skills (admin only).
	resp := e.postAuth(t, "/api/v1/skills", map[string]string{"name": "TestRoleSkill"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 for observer creating skill, got %d", resp.StatusCode)
	}

	env := decodeBody(t, resp)
	var errObj map[string]string
	json.Unmarshal(env["error"], &errObj) //nolint:errcheck
	if errObj["code"] != "FORBIDDEN" {
		t.Errorf("expected error code FORBIDDEN, got %q", errObj["code"])
	}
}

// -- Edge case / regression tests for bugs fixed in code review --------------

func TestUsers_Get_MalformedUUID_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "uuid_test@test.local", "pass", "developer")
	token := e.loginToken(t, "uuid_test@test.local", "pass")

	// Malformed UUID must return 404 (resource can never exist), not 500.
	resp := e.get(t, "/api/v1/users/not-a-valid-uuid", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed UUID, got %d", resp.StatusCode)
	}
}

func TestSkills_Create_MalformedUUID_MemberSkill_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "ms_uuid@test.local", "pass", "developer")
	token := e.loginToken(t, "ms_uuid@test.local", "pass")
	id := e.userID(t, "ms_uuid@test.local")

	// PUT with malformed skill_id in URL -- must 404, not 500.
	resp := e.putAuth(t, "/api/v1/users/"+id+"/skills/not-a-uuid",
		map[string]string{"level": "expert", "interest": "high"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed skill UUID, got %d", resp.StatusCode)
	}
}

func TestTeams_AddMember_InvalidCapacity(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "cap_admin@test.local", "pass", "admin")
	e.seedUser(t, "cap_member@test.local", "pass", "developer")

	adminToken := e.loginToken(t, "cap_admin@test.local", "pass")
	memberID := e.userID(t, "cap_member@test.local")

	// Create team.
	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Cap Test Team"}, adminToken)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", team.ID) //nolint:errcheck
	})

	// Negative capacity must be rejected.
	negResp := e.postAuth(t, "/api/v1/teams/"+team.ID+"/members",
		map[string]any{"user_id": memberID, "capacity_hours": -1}, adminToken)
	defer negResp.Body.Close()
	if negResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for negative capacity, got %d", negResp.StatusCode)
	}

	// Over-168 capacity must be rejected.
	overResp := e.postAuth(t, "/api/v1/teams/"+team.ID+"/members",
		map[string]any{"user_id": memberID, "capacity_hours": 200}, adminToken)
	defer overResp.Body.Close()
	if overResp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for capacity > 168, got %d", overResp.StatusCode)
	}
}

func TestTeams_AddMember_ReturnsFullUserDetails(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "full_admin@test.local", "pass", "admin")
	e.seedUser(t, "full_member@test.local", "pass", "tester")

	adminToken := e.loginToken(t, "full_admin@test.local", "pass")
	memberID := e.userID(t, "full_member@test.local")

	createResp := e.postAuth(t, "/api/v1/teams", map[string]any{"name": "Full Details Team"}, adminToken)
	createEnv := decodeBody(t, createResp)
	var team struct{ ID string `json:"id"` }
	json.Unmarshal(createEnv["data"], &team) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM teams WHERE id = $1", team.ID) //nolint:errcheck
	})

	addResp := e.postAuth(t, "/api/v1/teams/"+team.ID+"/members",
		map[string]any{"user_id": memberID, "capacity_hours": 40}, adminToken)
	if addResp.StatusCode != http.StatusOK {
		t.Fatalf("add member: expected 200, got %d", addResp.StatusCode)
	}
	addEnv := decodeBody(t, addResp)

	var member struct {
		UserID      string `json:"user_id"`
		Email       string `json:"email"`
		DisplayName string `json:"display_name"`
		Role        string `json:"role"`
	}
	json.Unmarshal(addEnv["data"], &member) //nolint:errcheck

	if member.Email == "" {
		t.Error("AddMember response must include email")
	}
	if member.DisplayName == "" {
		t.Error("AddMember response must include display_name")
	}
	if member.Role != "tester" {
		t.Errorf("expected role 'tester', got %q", member.Role)
	}
	if member.UserID != memberID {
		t.Errorf("expected user_id %s, got %s", memberID, member.UserID)
	}
}

func TestMemberSkills_UpsertNonexistentSkill_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "ms_nosk@test.local", "pass", "developer")

	token := e.loginToken(t, "ms_nosk@test.local", "pass")
	id := e.userID(t, "ms_nosk@test.local")

	// Valid UUID format but skill doesn't exist in DB.
	nonExistentSkill := "00000000-0000-0000-0000-000000000001"
	resp := e.putAuth(t, "/api/v1/users/"+id+"/skills/"+nonExistentSkill,
		map[string]string{"level": "expert", "interest": "high"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for non-existent skill, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Round 2 regression tests
// ---------------------------------------------------------------------------

// Admin cannot change their own role -- prevents self-lockout.
func TestUsers_Update_AdminSelfRoleChange_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_norole@test.local", "pass", "admin")

	token := e.loginToken(t, "admin_norole@test.local", "pass")
	id := e.userID(t, "admin_norole@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+id,
		map[string]interface{}{"role": "observer"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 when admin changes own role, got %d", resp.StatusCode)
	}
}

// Admin can still change another user's role -- guard is self-only.
func TestUsers_Update_AdminChangesOtherRole_OK(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_rolechg@test.local", "pass", "admin")
	e.seedUser(t, "dev_rolechg@test.local", "pass", "developer")

	adminToken := e.loginToken(t, "admin_rolechg@test.local", "pass")
	devID := e.userID(t, "dev_rolechg@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+devID,
		map[string]interface{}{"role": "tester"}, adminToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 when admin changes another user role, got %d", resp.StatusCode)
	}
}

// display_name longer than 200 chars must be rejected.
func TestUsers_Update_DisplayName_TooLong(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "longname@test.local", "pass", "developer")

	token := e.loginToken(t, "longname@test.local", "pass")
	id := e.userID(t, "longname@test.local")

	longName := strings.Repeat("x", 201)
	resp := e.patchAuth(t, "/api/v1/users/"+id,
		map[string]interface{}{"display_name": longName}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for display_name > 200 chars, got %d", resp.StatusCode)
	}
}

// Skill name longer than 100 chars must be rejected.
func TestSkills_Create_NameTooLong(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_sk_long@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_sk_long@test.local", "pass")

	longName := strings.Repeat("s", 101)
	resp := e.postAuth(t, "/api/v1/skills",
		map[string]interface{}{"name": longName, "category": "lang"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for skill name > 100 chars, got %d", resp.StatusCode)
	}
}

// Team name longer than 200 chars must be rejected on create.
func TestTeams_Create_NameTooLong(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_tm_long@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_tm_long@test.local", "pass")

	longName := strings.Repeat("t", 201)
	resp := e.postAuth(t, "/api/v1/teams",
		map[string]interface{}{"name": longName}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for team name > 200 chars, got %d", resp.StatusCode)
	}
}

// Team name longer than 200 chars must be rejected on update too.
func TestTeams_Update_NameTooLong(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_tm_upd_long@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_tm_upd_long@test.local", "pass")

	// Create a valid team first.
	createResp := e.postAuth(t, "/api/v1/teams",
		map[string]interface{}{"name": "team-upd-long"}, token)
	defer createResp.Body.Close()
	if createResp.StatusCode != http.StatusCreated {
		t.Fatalf("setup: failed to create team, got %d", createResp.StatusCode)
	}
	var env struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(createResp.Body).Decode(&env); err != nil {
		t.Fatalf("setup: decode response: %v", err)
	}

	longName := strings.Repeat("t", 201)
	resp := e.patchAuth(t, "/api/v1/teams/"+env.Data.ID,
		map[string]interface{}{"name": longName}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for team name > 200 chars on update, got %d", resp.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Round 3 -- crazy monkey tests
// ---------------------------------------------------------------------------

// -- helpers -----------------------------------------------------------------

// createTeam creates a team and returns its ID.  Fails fast on non-201.
func (e *testEnv) createTeam(t *testing.T, name, token string) string {
	t.Helper()
	resp := e.postAuth(t, "/api/v1/teams", map[string]interface{}{"name": name}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("createTeam %q: expected 201, got %d", name, resp.StatusCode)
	}
	var env struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		t.Fatalf("createTeam %q: decode: %v", name, err)
	}
	return env.Data.ID
}

// -- DELETE handlers: malformed UUID must be 404, not 500 --------------------

// Bug R3-1a: DELETE /teams/not-a-uuid returned 500 (parseUUID → ErrNotFound,
// but Delete handler had no ErrNotFound check).
func TestTeams_Delete_MalformedUUID_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_del_bad@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_del_bad@test.local", "pass")

	resp := e.deleteAuth(t, "/api/v1/teams/not-a-valid-uuid", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed team UUID on delete, got %d", resp.StatusCode)
	}
}

// Bug R3-1b: DELETE /teams/{id}/members/not-uuid returned 500.
func TestTeams_RemoveMember_MalformedUUID_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_rmbad@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_rmbad@test.local", "pass")
	teamID := e.createTeam(t, "team-rmbad", token)

	resp := e.deleteAuth(t, "/api/v1/teams/"+teamID+"/members/not-a-uuid", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed member UUID on remove, got %d", resp.StatusCode)
	}
}

// Bug R3-1c: DELETE /users/{id}/skills/not-uuid returned 500.
func TestUsers_DeleteSkill_MalformedSkillUUID_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_delbad@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_delbad@test.local", "pass")
	id := e.userID(t, "dev_delbad@test.local")

	resp := e.deleteAuth(t, "/api/v1/users/"+id+"/skills/not-a-uuid", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed skill UUID on delete, got %d", resp.StatusCode)
	}
}

// Delete of non-existent (but valid UUID format) team must be idempotent → 204.
func TestTeams_Delete_NonExistent_Idempotent(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_delidm@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_delidm@test.local", "pass")

	resp := e.deleteAuth(t, "/api/v1/teams/00000000-0000-0000-0000-000000000001", token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent {
		t.Fatalf("expected 204 for delete of non-existent team, got %d", resp.StatusCode)
	}
}

// -- Null bytes in text fields -----------------------------------------------

// Bug R3-2a: PostgreSQL rejects strings with null bytes (0x00) with a hard error.
// Without a guard, any null byte in a name → DB error → 500.
func TestSkills_Create_NullByte_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_nb_sk@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_nb_sk@test.local", "pass")

	// json.Marshal encodes \x00 as \u0000 -- server decodes it back to null byte.
	resp := e.postAuth(t, "/api/v1/skills",
		map[string]interface{}{"name": "go\x00lang"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for null byte in skill name, got %d", resp.StatusCode)
	}
}

// Bug R3-2b: null byte in team name.
func TestTeams_Create_NullByte_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_nb_tm@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_nb_tm@test.local", "pass")

	resp := e.postAuth(t, "/api/v1/teams",
		map[string]interface{}{"name": "team\x00evil"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for null byte in team name, got %d", resp.StatusCode)
	}
}

// Bug R3-2c: null byte in display_name.
func TestUsers_Update_NullByteInDisplayName_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_nb_dn@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_nb_dn@test.local", "pass")
	id := e.userID(t, "dev_nb_dn@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+id,
		map[string]interface{}{"display_name": "Alice\x00Bob"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for null byte in display_name, got %d", resp.StatusCode)
	}
}

// -- Admin self-deactivation guard -------------------------------------------

// Bug R3-3: admin could set own is_active=false → lock themselves out.
func TestUsers_Update_AdminSelfDeactivate_Forbidden(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_selfde@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_selfde@test.local", "pass")
	id := e.userID(t, "admin_selfde@test.local")

	isActive := false
	resp := e.patchAuth(t, "/api/v1/users/"+id,
		map[string]interface{}{"is_active": isActive}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Fatalf("expected 403 when admin deactivates own account, got %d", resp.StatusCode)
	}
}

// Admin can still deactivate another user.
func TestUsers_Update_AdminDeactivatesOther_OK(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_deact@test.local", "pass", "admin")
	e.seedUser(t, "dev_deact@test.local", "pass", "developer")
	adminToken := e.loginToken(t, "admin_deact@test.local", "pass")
	devID := e.userID(t, "dev_deact@test.local")

	isActive := false
	resp := e.patchAuth(t, "/api/v1/users/"+devID,
		map[string]interface{}{"is_active": isActive}, adminToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 when admin deactivates other user, got %d", resp.StatusCode)
	}
}

// -- AvatarURL length limit --------------------------------------------------

func TestUsers_Update_AvatarURL_TooLong_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_avlong@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_avlong@test.local", "pass")
	id := e.userID(t, "dev_avlong@test.local")

	longURL := "https://example.com/" + strings.Repeat("x", 2050)
	resp := e.patchAuth(t, "/api/v1/users/"+id,
		map[string]interface{}{"avatar_url": longURL}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for avatar_url > 2048 chars, got %d", resp.StatusCode)
	}
}

// -- Role string normalisation ------------------------------------------------

// Role with surrounding whitespace is trimmed and accepted.
func TestUsers_Update_Role_TrimmedWhitespace_OK(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_rtrm@test.local", "pass", "admin")
	e.seedUser(t, "dev_rtrm@test.local", "pass", "developer")
	adminToken := e.loginToken(t, "admin_rtrm@test.local", "pass")
	devID := e.userID(t, "dev_rtrm@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+devID,
		map[string]interface{}{"role": " tester "}, adminToken)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for role with surrounding whitespace, got %d", resp.StatusCode)
	}
}

// Role with invalid value (uppercase, garbage) must be 400.
func TestUsers_Update_Role_Invalid_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_rinv@test.local", "pass", "admin")
	e.seedUser(t, "dev_rinv@test.local", "pass", "developer")
	adminToken := e.loginToken(t, "admin_rinv@test.local", "pass")
	devID := e.userID(t, "dev_rinv@test.local")

	for _, bad := range []string{"ADMIN", "superuser", "", "god"} {
		resp := e.patchAuth(t, "/api/v1/users/"+devID,
			map[string]interface{}{"role": bad}, adminToken)
		resp.Body.Close()
		if resp.StatusCode != http.StatusBadRequest {
			t.Fatalf("expected 400 for role=%q, got %d", bad, resp.StatusCode)
		}
	}
}

// -- Wrong JSON types --------------------------------------------------------

// Sending a string where an int16 is expected must return 400, not 500.
func TestTeams_AddMember_CapacityWrongType_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_cap_type@test.local", "pass", "admin")
	e.seedUser(t, "dev_cap_type@test.local", "pass", "developer")
	token := e.loginToken(t, "admin_cap_type@test.local", "pass")
	teamID := e.createTeam(t, "team-cap-type", token)
	devID := e.userID(t, "dev_cap_type@test.local")

	// capacity_hours is int16 on the server; sending a string must be rejected.
	body := strings.NewReader(`{"user_id":"` + devID + `","capacity_hours":"forty"}`)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/teams/"+teamID+"/members", body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for string capacity_hours, got %d", resp.StatusCode)
	}
}

// Sending bool where string is expected must return 400.
func TestUsers_Update_IsActive_WrongType_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_iat@test.local", "pass", "admin")
	e.seedUser(t, "dev_iat@test.local", "pass", "developer")
	token := e.loginToken(t, "admin_iat@test.local", "pass")
	devID := e.userID(t, "dev_iat@test.local")

	// is_active expects bool; sending string "true" should fail.
	body := strings.NewReader(`{"is_active":"yes"}`)
	req, _ := http.NewRequest(http.MethodPatch, e.srv.URL+"/api/v1/users/"+devID, body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for string is_active, got %d", resp.StatusCode)
	}
}

// JSON array instead of object must return 400.
func TestSkills_Create_ArrayBody_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_arr_sk@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_arr_sk@test.local", "pass")

	body := strings.NewReader(`[{"name":"Go"}]`)
	req, _ := http.NewRequest(http.MethodPost, e.srv.URL+"/api/v1/skills", body)
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for array body on POST /skills, got %d", resp.StatusCode)
	}
}

// -- Empty / no-op PATCH -----------------------------------------------------

// PATCH with empty JSON object is a no-op; must return 200 with unchanged user.
func TestUsers_Update_EmptyPatch_NoOp(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_noop@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_noop@test.local", "pass")
	id := e.userID(t, "dev_noop@test.local")

	resp := e.patchAuth(t, "/api/v1/users/"+id, map[string]interface{}{}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("expected 200 for empty PATCH, got %d", resp.StatusCode)
	}
}

// -- Missing required fields -------------------------------------------------

// POST /teams without name must return 400, not 500.
func TestTeams_Create_MissingName_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_noname@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_noname@test.local", "pass")

	resp := e.postAuth(t, "/api/v1/teams", map[string]interface{}{"description": "no name"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing team name, got %d", resp.StatusCode)
	}
}

// POST /teams/members without user_id must return 400.
func TestTeams_AddMember_MissingUserID_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_nouserid@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_nouserid@test.local", "pass")
	teamID := e.createTeam(t, "team-nouserid", token)

	resp := e.postAuth(t, "/api/v1/teams/"+teamID+"/members",
		map[string]interface{}{}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for missing user_id, got %d", resp.StatusCode)
	}
}

// POST /teams/members with malformed user_id (valid string, bad UUID) → 400.
func TestTeams_AddMember_MalformedUserID_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_baduserid@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_baduserid@test.local", "pass")
	teamID := e.createTeam(t, "team-baduserid", token)

	resp := e.postAuth(t, "/api/v1/teams/"+teamID+"/members",
		map[string]interface{}{"user_id": "not-a-uuid"}, token)
	defer resp.Body.Close()
	// parseUUID fails → ErrNotFound → 400 (team or user not found)
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for malformed user_id, got %d", resp.StatusCode)
	}
}

// -- UpsertSkill edge cases --------------------------------------------------

// PUT /users/{id}/skills/{skill_id} with empty level must return 400.
func TestUsers_UpsertSkill_EmptyLevel_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_emptylv@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_emptylv@test.local", "pass")
	id := e.userID(t, "dev_emptylv@test.local")

	// List skills to get a valid skill ID.
	listResp := e.makeReq(t, http.MethodGet, "/api/v1/skills", nil, token)
	defer listResp.Body.Close()
	var skillsEnv struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.NewDecoder(listResp.Body).Decode(&skillsEnv)
	if len(skillsEnv.Data) == 0 {
		t.Skip("no skills seeded")
	}
	skillID := skillsEnv.Data[0].ID

	resp := e.putAuth(t, "/api/v1/users/"+id+"/skills/"+skillID,
		map[string]string{"level": "", "interest": "high"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for empty level, got %d", resp.StatusCode)
	}
}

// PUT with invalid interest value must return 400.
func TestUsers_UpsertSkill_InvalidInterest_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_badintr@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_badintr@test.local", "pass")
	id := e.userID(t, "dev_badintr@test.local")

	listResp := e.makeReq(t, http.MethodGet, "/api/v1/skills", nil, token)
	defer listResp.Body.Close()
	var skillsEnv struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	json.NewDecoder(listResp.Body).Decode(&skillsEnv)
	if len(skillsEnv.Data) == 0 {
		t.Skip("no skills seeded")
	}
	skillID := skillsEnv.Data[0].ID

	resp := e.putAuth(t, "/api/v1/users/"+id+"/skills/"+skillID,
		map[string]string{"level": "expert", "interest": "VERY_HIGH"}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for invalid interest value, got %d", resp.StatusCode)
	}
}

// -- AddMember UPSERT is idempotent ------------------------------------------

// Re-adding an existing member with a different capacity must succeed (UPSERT).
func TestTeams_AddMember_ReAdd_UpdatesCapacity(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_readd@test.local", "pass", "admin")
	e.seedUser(t, "dev_readd@test.local", "pass", "developer")
	token := e.loginToken(t, "admin_readd@test.local", "pass")
	teamID := e.createTeam(t, "team-readd", token)
	devID := e.userID(t, "dev_readd@test.local")

	// First add -- capacity 20.
	r1 := e.postAuth(t, "/api/v1/teams/"+teamID+"/members",
		map[string]interface{}{"user_id": devID, "capacity_hours": 20}, token)
	defer r1.Body.Close()
	if r1.StatusCode != http.StatusOK {
		t.Fatalf("first add: expected 200, got %d", r1.StatusCode)
	}

	// Second add -- capacity 40. Must succeed (UPSERT) and return updated capacity.
	r2 := e.postAuth(t, "/api/v1/teams/"+teamID+"/members",
		map[string]interface{}{"user_id": devID, "capacity_hours": 40}, token)
	defer r2.Body.Close()
	if r2.StatusCode != http.StatusOK {
		t.Fatalf("second add (upsert): expected 200, got %d", r2.StatusCode)
	}
	var env struct {
		Data struct {
			CapacityHours int `json:"capacity_hours"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r2.Body).Decode(&env); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if env.Data.CapacityHours != 40 {
		t.Fatalf("expected capacity_hours=40 after upsert, got %d", env.Data.CapacityHours)
	}
}

// -- GET /users/{id}/skills for non-existent user → 404 ----------------------

func TestUsers_ListSkills_NonexistentUser_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_lsne@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_lsne@test.local", "pass")

	resp := e.makeReq(t, http.MethodGet,
		"/api/v1/users/00000000-0000-0000-0000-000000000001/skills", nil, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for skills of non-existent user, got %d", resp.StatusCode)
	}
}

// -- capacity_hours boundary: 0 and 168 are valid ----------------------------

func TestTeams_AddMember_CapacityBoundaries_Valid(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_capbnd@test.local", "pass", "admin")
	e.seedUser(t, "dev_capbnd@test.local", "pass", "developer")
	token := e.loginToken(t, "admin_capbnd@test.local", "pass")
	teamID := e.createTeam(t, "team-capbnd", token)
	devID := e.userID(t, "dev_capbnd@test.local")

	for _, cap := range []int{0, 168} {
		r := e.postAuth(t, "/api/v1/teams/"+teamID+"/members",
			map[string]interface{}{"user_id": devID, "capacity_hours": cap}, token)
		r.Body.Close()
		if r.StatusCode != http.StatusOK {
			t.Fatalf("capacity_hours=%d: expected 200, got %d", cap, r.StatusCode)
		}
	}
}

// -- GET /teams/not-uuid → 404, not 500 --------------------------------------

func TestTeams_Get_MalformedUUID_Returns404(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "dev_getbad@test.local", "pass", "developer")
	token := e.loginToken(t, "dev_getbad@test.local", "pass")

	resp := e.makeReq(t, http.MethodGet, "/api/v1/teams/not-a-uuid", nil, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusNotFound {
		t.Fatalf("expected 404 for malformed team UUID on GET, got %d", resp.StatusCode)
	}
}

// -- Unicode in names is accepted (valid UTF-8 is fine) ----------------------

func TestSkills_Create_Unicode_OK(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_uni@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_uni@test.local", "pass")

	// Unique enough: test name prefix keeps collision risk near zero across runs.
	skillName := "TestUnicodeSkill-\u0410\u043b\u0433\u043e\u0440\u0438\u0442\u043c\u044b"
	// Pre-clean in case a prior run left this skill behind.
	e.pool.Exec(context.Background(), "DELETE FROM skills WHERE name = $1", skillName) //nolint:errcheck
	t.Cleanup(func() {
		e.pool.Exec(context.Background(), "DELETE FROM skills WHERE name = $1", skillName) //nolint:errcheck
	})

	resp := e.postAuth(t, "/api/v1/skills",
		map[string]interface{}{"name": skillName}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		t.Fatalf("expected 201 for Unicode skill name, got %d", resp.StatusCode)
	}
}

// -- Whitespace-only name must be rejected -----------------------------------

func TestTeams_Create_WhitespaceOnlyName_Returns400(t *testing.T) {
	e := newTestEnv(t)
	e.seedUser(t, "admin_wsonly@test.local", "pass", "admin")
	token := e.loginToken(t, "admin_wsonly@test.local", "pass")

	resp := e.postAuth(t, "/api/v1/teams",
		map[string]interface{}{"name": "   \t\n  "}, token)
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("expected 400 for whitespace-only team name, got %d", resp.StatusCode)
	}
}
