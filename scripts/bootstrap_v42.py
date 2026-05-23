#!/usr/bin/env python3
"""
V.42 Munchausen Bootstrap
Pulls itself up by its bootstraps: creates users, epics, backlog, sprint
via the V.42 API. Run once after a fresh deploy.

Usage:
    python3 scripts/bootstrap_v42.py [--base-url http://localhost:8080]
"""
import sys
import json
import argparse
import urllib.request
import urllib.error
from datetime import date, timedelta

BASE_URL = "http://localhost:8080"

# --- Known IDs (from initial seed) ---
PROJECT_ID  = "75b310d5-46b2-4f91-a6b0-fc8489054e35"
TEAM_ID     = "81af9417-d081-48db-bf78-d2b40bc0ed52"
ADMIN_EMAIL = "admin@v42.local"
ADMIN_PASS  = "changeme"

# Skills (from DB: GET /api/v1/skills)
SKILL_GO         = "ccf37154-638e-42dc-bba3-b13ef5dfe028"
SKILL_TS         = "830e4cb6-53ce-4c14-b654-5d6810f2f4eb"
SKILL_SQL        = "9b45f57a-3336-4ee7-bc3b-798c24f7e83d"
SKILL_PG         = "b29a9363-0fcd-4300-9cf8-df5270b98a41"
SKILL_REACT      = "c165e1bb-cdd5-4445-9a01-9c5eec2523bc"
SKILL_ARCH       = "1a602032-9d44-4f26-828c-0c9eb9eb759c"
SKILL_DOCKER     = "db44312c-1776-407c-a0a8-6ede05335b9b"
SKILL_AGILE      = "2075ed48-20af-43f0-8c96-92a2ba12724e"
SKILL_PLAYWRIGHT = "c278f165-3410-4dab-be2b-66551ceb17ed"
SKILL_WRITING    = "1b807799-ad46-4c88-bb10-0d99e7913f69"

# --- Agents ---
AGENTS = [
    {
        "email": "copilot@v42.local",
        "password": "Copilot42!secure",
        "display_name": "GitHub Copilot",
        "role": "maintainer",
        "skills": [
            (SKILL_GO,      "expert",    7),
            (SKILL_TS,      "expert",    7),
            (SKILL_SQL,     "expert",    5),
            (SKILL_PG,      "expert",    5),
            (SKILL_REACT,   "expert",    7),
            (SKILL_ARCH,    "expert",    5),
            (SKILL_DOCKER,  "expert",    3),
            (SKILL_AGILE,   "proficient", 3),
            (SKILL_PLAYWRIGHT, "expert", 3),
            (SKILL_WRITING, "proficient", 2),
        ],
        "weekly_capacity": 40,
    },
    {
        "email": "vpo@v42.local",
        "password": "Vpo42!secure",
        "display_name": "vpo",
        "role": "admin",
        "skills": [
            (SKILL_ARCH,  "expert",    5),
            (SKILL_GO,    "proficient", 5),
            (SKILL_TS,    "proficient", 5),
            (SKILL_AGILE, "expert",    5),
            (SKILL_WRITING, "expert", 3),
        ],
        "weekly_capacity": 20,
    },
]

# --- Epics (phases) ---
EPICS = [
    ("Phase 0 -- Foundation",       "done",    "Go project layout, Makefile, Docker-compose, CI skeleton, slog, config, graceful shutdown."),
    ("Phase 1 -- Schema",           "done",    "22 tables, 13 ENUM types, 10 migrations (000001-000010). Full DESIGN.md schema implemented."),
    ("Phase 2 -- Auth",             "done",    "JWT access (15min) + refresh tokens (7d), bcrypt passwords, httpOnly cookie, rate limiting. 15 integration tests."),
    ("Phase 3 -- Users & Teams",    "done",    "Users CRUD, skills catalog + member_skills, teams + capacity. 74 integration tests."),
    ("Phase 3c -- Multi-team M:M",  "done",    "project_teams junction table. Projects can have multiple teams. Migration 000010 applied."),
    ("Phase 4 -- Work Items",       "done",    "Projects, epics, backlog (ATDD), tasks, comments, time entries. 50 integration tests."),
    ("Phase 4.5 -- Sprints",        "done",    "Sprint CRUD, sprint_items, sprint_test_results. Board view endpoint missing (client-side workaround)."),
    ("Phase 5 -- Releases & Stages","active",  "Releases and stages: schema ready (tables exist since migration 000001). Handlers, store, frontend TBD."),
    ("Phase 6 -- Clarity + Stats",  "draft",   "Dashboard stats, velocity charts, burndown, member workload. Aggregation queries."),
    ("Phase 7 -- SSE Real-time",    "draft",   "SSE /events stream: broadcast project/sprint/backlog changes to connected clients."),
    ("Phase 8 -- UI Polish & DnD",  "draft",   "dnd-kit drag-and-drop boards, sprint board DnD, keyboard nav, dark mode, Playwright suite expansion."),
]

# --- Phase 5 backlog items ---
# type: story|bug|feature|technical_debt  status: backlog|ready|in_progress|review|done|cancelled
# estimate: string (SP), ac_setup=GIVEN, ac_steps=WHEN, ac_expected=THEN
PHASE5_ITEMS = [
    {
        "title": "releases.sql queries + sqlc gen",
        "description": "Write sqlc queries: CreateRelease, GetRelease, ListReleasesByProject, UpdateRelease, DeleteRelease. Edit internal/db/gen/ manually (no sqlc CLI).",
        "type": "story", "status": "backlog", "estimate": "3",
        "ac_setup": "A project exists in the database.",
        "ac_steps": "POST /api/v1/projects/{id}/releases with valid payload.",
        "ac_expected": "Release created with HTTP 201. GET list returns paginated results.",
    },
    {
        "title": "stages.sql queries + sqlc gen",
        "description": "Write sqlc queries for stages: CreateStage, ListStagesByRelease, UpdateStage, ReorderStages (FLOAT8 midpoint). Edit gen/ manually.",
        "type": "story", "status": "backlog", "estimate": "3",
        "ac_setup": "A release exists in the database.",
        "ac_steps": "POST /releases/{id}/stages; PATCH /stages/{id}/order.",
        "ac_expected": "Stage created. Order update uses FLOAT8 midpoint without gaps or collisions.",
    },
    {
        "title": "Releases store layer",
        "description": "internal/db/store/releases.go: ReleaseStore with Create, Get, List, Update, Delete. Map gen rows to store structs.",
        "type": "story", "status": "backlog", "estimate": "2",
        "ac_setup": "Valid release params provided.",
        "ac_steps": "Call store.Create then store.List for a project.",
        "ac_expected": "Record inserted and returned. List ordered by target_date.",
    },
    {
        "title": "Stages store layer",
        "description": "internal/db/store/stages.go: StageStore with CRUD + Reorder (midpoint). Allow backlog_items.stage_id FK.",
        "type": "story", "status": "backlog", "estimate": "2",
        "ac_setup": "Two stages exist in a release.",
        "ac_steps": "Call Reorder with new position between existing stages.",
        "ac_expected": "stage.order_index updated to midpoint. No gaps or collisions.",
    },
    {
        "title": "Releases HTTP handlers",
        "description": "internal/api/handler_releases.go: List, Create, Get, Update, Delete. Wire under /projects/{project_id}/releases.",
        "type": "story", "status": "backlog", "estimate": "3",
        "ac_setup": "Project exists; admin and developer users exist.",
        "ac_steps": "POST as admin; POST as developer; DELETE with invalid project_id.",
        "ac_expected": "Admin POST returns 201. Developer POST returns 403. Bad project_id returns 404.",
    },
    {
        "title": "Stages HTTP handlers",
        "description": "internal/api/handler_stages.go: List, Create, Get, Update, Delete, Reorder. Wire under /releases/{release_id}/stages.",
        "type": "story", "status": "backlog", "estimate": "3",
        "ac_setup": "Release exists with two stages.",
        "ac_steps": "GET /releases/{id}/stages; PATCH /stages/{id}/order.",
        "ac_expected": "Ordered list returned. Reorder applied. Backlog filterable by stage_id.",
    },
    {
        "title": "Integration tests: releases + stages",
        "description": "internal/api/releases_stages_test.go -- CRUD, auth checks, ordering, backlog filter. Target: 20+ tests green.",
        "type": "story", "status": "backlog", "estimate": "4",
        "ac_setup": "Test DB running with all migrations applied.",
        "ac_steps": "go test -tags=integration ./internal/api/... -run TestReleases",
        "ac_expected": "All tests pass. Coverage: create/get/list/update/delete/reorder, 403/404 cases.",
    },
    {
        "title": "Frontend: ReleasesPage + hooks",
        "description": "src/pages/ReleasesPage.tsx, src/hooks/useReleases.ts, src/api/endpoints/releases.ts. List and create releases.",
        "type": "story", "status": "backlog", "estimate": "5",
        "ac_setup": "Project page open in browser; admin and developer accounts available.",
        "ac_steps": "Click Releases tab; submit create release form as admin.",
        "ac_expected": "List renders. New release appears without page reload.",
    },
    {
        "title": "Frontend: StagesPanel in ReleaseDetail",
        "description": "src/pages/ReleaseDetailPage.tsx -- stages as columns. Backlog items grouped by stage. Reorder stub (full DnD is Phase 8).",
        "type": "story", "status": "backlog", "estimate": "5",
        "ac_setup": "Release with stages and backlog items with stage_id exist.",
        "ac_steps": "Navigate to ReleaseDetailPage.",
        "ac_expected": "Stages in order. Backlog items under correct stage column.",
    },
    {
        "title": "Phase 3c integration tests (project-team M:M)",
        "description": "Write tests for GET/POST/DELETE /projects/{id}/teams. Zero coverage today. Target: 10 tests.",
        "type": "technical_debt", "status": "backlog", "estimate": "2",
        "ac_setup": "Project and two teams exist; admin and developer users exist.",
        "ac_steps": "POST team to project; GET teams; DELETE team as developer.",
        "ac_expected": "POST 201, GET lists team, developer DELETE returns 403, admin DELETE 204.",
    },
    {
        "title": "Project visibility filter (security gap)",
        "description": "ListProjects must filter by team membership. Non-admin sees only projects where they are in a linked team.",
        "type": "technical_debt", "status": "backlog", "estimate": "3",
        "ac_setup": "Project X linked to Team A only. Developer is member of Team B.",
        "ac_steps": "GET /api/v1/projects as developer in Team B.",
        "ac_expected": "Project X absent. Admin sees all. Developer in Team A sees Project X.",
    },
    {
        "title": "24h comment edit window enforcement",
        "description": "commentH.Update: check created_at + 24h > now(). Return 403 EDIT_WINDOW_EXPIRED if stale.",
        "type": "technical_debt", "status": "backlog", "estimate": "1",
        "ac_setup": "Comment A is under 24h old; Comment B is over 24h old.",
        "ac_steps": "PATCH /comments/A then PATCH /comments/B.",
        "ac_expected": "Comment A returns 200. Comment B returns 403 EDIT_WINDOW_EXPIRED.",
    },
    {
        "title": "Sprint board view endpoint",
        "description": "GET /api/v1/sprints/{id}/board -- items grouped by status. Frontend currently groups client-side.",
        "type": "technical_debt", "status": "backlog", "estimate": "2",
        "ac_setup": "Sprint with items in todo, in_progress, done statuses.",
        "ac_steps": "GET /api/v1/sprints/{id}/board",
        "ac_expected": "Response: [{status: todo, items: [...]}, {status: in_progress, ...}, {status: done, ...}].",
    },
]

# --- Sprint ---
SPRINT = {
    "name": "Sprint 1 -- Phase 5 Kickoff",
    "goal": "Implement Releases + Stages backend (queries, store, handlers, tests). Close 3c and security debt.",
    "start_date": str(date.today()),
    "end_date":   str(date.today() + timedelta(days=13)),
}


# ===== HTTP helpers =====

def api(method: str, path: str, body=None, token: str = None) -> dict:
    url  = f"{BASE_URL}/api/v1{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as resp:
            raw = resp.read()
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        print(f"  ERROR {e.code} {method} {path}: {body[:200]}")
        return {}


def login(email: str, password: str) -> str:
    r = api("POST", "/auth/login", {"email": email, "password": password})
    token = r.get("data", {}).get("access_token", "")
    if not token:
        print(f"  FATAL: cannot login as {email}")
        sys.exit(1)
    return token


def ok(label: str, r: dict) -> str:
    """Extract data.id and print status."""
    data = r.get("data") or {}
    item_id = data.get("id", "")
    if item_id:
        print(f"  OK  {label}: {item_id}")
    else:
        print(f"  --- {label}: no id returned (may already exist)")
    return item_id


# ===== Bootstrap steps =====

def create_agents(admin_token: str) -> dict[str, str]:
    """Create agent users, assign skills, return {email: user_id}."""
    print("\n[1] Creating agent users...")
    ids = {}
    for agent in AGENTS:
        r = api("POST", "/users", {
            "email":          agent["email"],
            "password":       agent["password"],
            "display_name":   agent["display_name"],
            "role":           agent["role"],
            "weekly_capacity": agent["weekly_capacity"],
        }, admin_token)
        uid = ok(agent["email"], r)
        if not uid:
            # Try to find by email (already exists)
            users = api("GET", "/users?limit=100", token=admin_token)
            for u in (users.get("data") or []):
                if u.get("email") == agent["email"]:
                    uid = u["id"]
                    print(f"  -> already exists: {uid}")
                    break
        if uid:
            ids[agent["email"]] = uid

    print("\n[2] Assigning skills to agents...")
    for agent in AGENTS:
        uid = ids.get(agent["email"])
        if not uid:
            continue
        for skill_id, level, yoe in agent["skills"]:
            # Route: PUT /users/{id}/skills/{skill_id}
            api("PUT", f"/users/{uid}/skills/{skill_id}", {
                "level":        level,
                "interest":     "high",
                "years_of_exp": yoe,
            }, admin_token)
        print(f"  OK  {agent['display_name']}: {len(agent['skills'])} skills")

    return ids


def add_to_team(admin_token: str, user_ids: dict[str, str]):
    """Add agent users to Core Team."""
    print("\n[3] Adding agents to Core Team...")
    # Ensure team is linked to project
    api("POST", f"/projects/{PROJECT_ID}/teams", {"team_id": TEAM_ID}, admin_token)

    for email, uid in user_ids.items():
        cap = next((a["weekly_capacity"] for a in AGENTS if a["email"] == email), 32)
        # AddMember is idempotent (upsert) -- safe to call even if already member
        r = api("POST", f"/teams/{TEAM_ID}/members", {"user_id": uid, "capacity_hours": cap}, admin_token)
        ok(f"team member {email}", r)


def create_epics(admin_token: str) -> dict[str, str]:
    """Create epics for all phases, return {phase_name: epic_id}."""
    print("\n[4] Creating phase epics...")
    epic_ids = {}
    for i, (name, status, desc) in enumerate(EPICS):
        r = api("POST", f"/projects/{PROJECT_ID}/epics", {
            "title":       name,
            "description": desc,
            "status":      status,
        }, admin_token)
        eid = ok(name, r)
        epic_ids[name] = eid
    return epic_ids


def create_backlog(admin_token: str, epic_ids: dict[str, str], copilot_id: str) -> list[str]:
    """Create Phase 5 backlog items under the Phase 5 epic."""
    print("\n[5] Creating Phase 5 backlog items...")
    epic_key = "Phase 5 -- Releases & Stages"
    epic_id  = epic_ids.get(epic_key, "")
    if not epic_id:
        print(f"  SKIP: epic '{epic_key}' not found")
        return []

    item_ids = []
    for i, item in enumerate(PHASE5_ITEMS):
        payload = {
            "epic_id":     epic_id,
            "title":       item["title"],
            "description": item["description"],
            "type":        item["type"],
            "status":      item["status"],
            "estimate":    item["estimate"],
            "ac_setup":    item.get("ac_setup"),
            "ac_steps":    item.get("ac_steps"),
            "ac_expected": item.get("ac_expected"),
        }
        if copilot_id:
            payload["assignee_id"] = copilot_id
        r = api("POST", f"/projects/{PROJECT_ID}/backlog", payload, admin_token)
        bid = ok(item["title"][:50], r)
        item_ids.append(bid)
    return item_ids


def create_sprint(admin_token: str, item_ids: list[str]) -> str:
    """Create Sprint 1, add Phase 5 backlog items to it."""
    print("\n[6] Creating Sprint 1...")
    r = api("POST", f"/projects/{PROJECT_ID}/sprints", {
        "name":       SPRINT["name"],
        "goal":       SPRINT["goal"],
        "start_date": SPRINT["start_date"],
        "end_date":   SPRINT["end_date"],
    }, admin_token)
    sprint_id = ok(SPRINT["name"], r)
    if not sprint_id:
        return ""

    print(f"  Adding {len(item_ids)} items to sprint...")
    added = 0
    for idx, bid in enumerate(item_ids):
        if not bid:
            continue
        # Sprint items route is nested: /projects/{proj_id}/sprints/{sprint_id}/items
        r2 = api("POST", f"/projects/{PROJECT_ID}/sprints/{sprint_id}/items", {
            "backlog_item_id": bid,
            "order_index":     float(idx + 1),
        }, admin_token)
        if r2.get("data"):
            added += 1
    print(f"  OK  {added}/{len(item_ids)} items added to sprint")
    return sprint_id


def print_summary(user_ids: dict, epic_ids: dict, sprint_id: str):
    print("\n" + "=" * 60)
    print("Bootstrap complete.")
    print(f"  Project : {PROJECT_ID}")
    print(f"  Team    : {TEAM_ID}")
    print(f"  Users   : {len(user_ids)} created/found")
    print(f"  Epics   : {sum(1 for v in epic_ids.values() if v)} created")
    print(f"  Sprint  : {sprint_id or 'FAILED'}")
    print(f"  UI      : http://localhost:5173/projects/{PROJECT_ID}")
    print("=" * 60)


# ===== Main =====

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://localhost:8080")
    args = parser.parse_args()
    global BASE_URL
    BASE_URL = args.base_url.rstrip("/")

    print(f"V.42 Munchausen Bootstrap -> {BASE_URL}")
    print(f"Project: {PROJECT_ID}")
    print(f"Team   : {TEAM_ID}")

    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    print(f"  Logged in as admin ({ADMIN_EMAIL})")

    user_ids  = create_agents(admin_token)
    add_to_team(admin_token, user_ids)
    epic_ids  = create_epics(admin_token)
    copilot_id = user_ids.get("copilot@v42.local", "")
    item_ids  = create_backlog(admin_token, epic_ids, copilot_id)
    sprint_id = create_sprint(admin_token, item_ids)

    print_summary(user_ids, epic_ids, sprint_id)


if __name__ == "__main__":
    main()
