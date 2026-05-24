#!/usr/bin/env python3
"""
V.42 Demo Seed
Populates a fresh V.42 instance with sample users, teams, projects,
epics, backlog items, and sprints so you can kick the tyres immediately.

All seeded users have must_change_password=true -- they MUST set a new
password on first login.

Usage:
    python3 scripts/seed_demo.py [--base-url http://localhost:8080]

    # Or via Docker (uses --profile seed):
    docker compose -f docker-compose.prod.yml --profile seed up seed
"""
import sys
import json
import time
import argparse
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DEFAULT_BASE_URL  = "http://localhost:8080"
ADMIN_EMAIL       = ""   # filled from --admin-email or env (falls back to SEED_ADMIN_EMAIL default)
ADMIN_PASSWORD    = ""   # filled from --admin-password or env

# Demo users: [email, password, display_name, role]
# Passwords are temporary -- users must change them on first login.
DEMO_USERS = [
    ("lead@example.com",      "V42Lead!demo",    "Alex Lead",    "maintainer"),
    ("dev1@example.com",      "V42Dev1!demo",    "Sam Dev",      "developer"),
    ("dev2@example.com",      "V42Dev2!demo",    "Kim Dev",      "developer"),
    ("tester@example.com",    "V42Test!demo",    "Lee Tester",   "tester"),
    ("observer@example.com",  "V42View!demo",    "Pat Observer", "viewer"),
]

# Demo skills to assign (pulled from existing skill catalog by name)
# We just pick a few to keep the seed idempotent even if skills change.
SKILL_NAMES_WANTED = [
    "Go", "TypeScript", "React", "PostgreSQL", "Docker", "Agile",
]

# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def _req(method, url, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body = e.read()
        try:
            return e.code, json.loads(body)
        except Exception:
            return e.code, {"raw": body.decode(errors="replace")}

def get(url, token=None):
    return _req("GET", url, token=token)

def post(url, body, token=None):
    return _req("POST", url, body, token=token)

def patch(url, body, token=None):
    return _req("PATCH", url, body, token=token)

def _ok(status, envelope, ctx=""):
    if status not in (200, 201):
        print(f"  ERROR {ctx}: HTTP {status} -- {envelope}")
        return False
    return True

# ---------------------------------------------------------------------------
# Wait for the API to be ready
# ---------------------------------------------------------------------------

def wait_for_api(base_url, retries=30, delay=2):
    url = f"{base_url}/api/v1/health"
    for i in range(retries):
        try:
            status, _ = get(url)
            if status == 200:
                print(f"  API ready at {base_url}")
                return True
        except Exception:
            pass
        print(f"  Waiting for API... ({i+1}/{retries})")
        time.sleep(delay)
    print("ERROR: API did not become ready in time.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Login helper
# ---------------------------------------------------------------------------

def login(base_url, email, password):
    status, resp = post(f"{base_url}/api/v1/auth/login", {"email": email, "password": password})
    if not _ok(status, resp, f"login {email}"):
        sys.exit(1)
    return resp["data"]["access_token"]

# ---------------------------------------------------------------------------
# Seed
# ---------------------------------------------------------------------------

def seed(base_url, admin_email, admin_password):
    print("\n[1] Waiting for API...")
    wait_for_api(base_url)

    print("\n[2] Logging in as admin...")
    token = login(base_url, admin_email, admin_password)
    print(f"  OK -- got access token")

    # ------------------------------------------------------------------
    # Create demo users
    # ------------------------------------------------------------------
    print("\n[3] Creating demo users...")
    created_users = {}  # email -> user_id

    for email, password, display_name, role in DEMO_USERS:
        status, resp = post(f"{base_url}/api/v1/admin/users", {
            "email": email,
            "password": password,
            "display_name": display_name,
            "role": role,
        }, token=token)
        if status == 409:
            print(f"  SKIP {email} (already exists)")
            # Fetch their ID
            s2, r2 = get(f"{base_url}/api/v1/admin/users", token=token)
            if _ok(s2, r2, "list users"):
                for u in r2.get("data", []):
                    if u["email"] == email:
                        created_users[email] = u["id"]
            continue
        if not _ok(status, resp, f"create {email}"):
            continue
        uid = resp["data"]["id"]
        created_users[email] = uid
        print(f"  OK {email} -> {uid}")

    # ------------------------------------------------------------------
    # Fetch skill catalog
    # ------------------------------------------------------------------
    print("\n[4] Fetching skill catalog...")
    status, resp = get(f"{base_url}/api/v1/skills", token=token)
    skill_map = {}  # name -> id
    if _ok(status, resp, "list skills"):
        for sk in resp.get("data", []):
            skill_map[sk["name"]] = sk["id"]
    print(f"  Found {len(skill_map)} skills")

    # ------------------------------------------------------------------
    # Assign a few skills to each demo user (best-effort)
    # ------------------------------------------------------------------
    print("\n[5] Assigning skills to users...")
    skill_assignments = {
        "lead@example.com":     [("Go", "expert", 5), ("Agile", "expert", 5), ("TypeScript", "proficient", 3)],
        "dev1@example.com":     [("Go", "proficient", 3), ("PostgreSQL", "proficient", 2), ("Docker", "novice", 1)],
        "dev2@example.com":     [("TypeScript", "expert", 4), ("React", "expert", 5), ("Docker", "novice", 1)],
        "tester@example.com":   [("Agile", "proficient", 3), ("TypeScript", "novice", 1)],
        "observer@example.com": [("Agile", "beginner", 1)],
    }
    for email, assignments in skill_assignments.items():
        uid = created_users.get(email)
        if not uid:
            continue
        for skill_name, level, yoe in assignments:
            sid = skill_map.get(skill_name)
            if not sid:
                continue
            s, r = post(f"{base_url}/api/v1/admin/users/{uid}/skills", {
                "skill_id": sid, "level": level, "years_of_experience": yoe
            }, token=token)
            if s == 409:
                pass  # already assigned -- fine
            elif not _ok(s, r, f"skill {skill_name} -> {email}"):
                pass
    print("  Done")

    # ------------------------------------------------------------------
    # Create a sample team
    # ------------------------------------------------------------------
    print("\n[6] Creating demo team...")
    status, resp = post(f"{base_url}/api/v1/teams", {
        "name": "Alpha Team",
        "description": "The founding crew. Builds everything from scratch.",
        "sprint_duration_days": 14,
    }, token=token)
    if status == 200 or status == 201:
        team_id = resp["data"]["id"]
        print(f"  OK team -> {team_id}")
    elif status == 409:
        print("  SKIP team (already exists -- fetching ID)")
        s2, r2 = get(f"{base_url}/api/v1/teams", token=token)
        team_id = None
        if _ok(s2, r2, "list teams"):
            for t in r2.get("data", []):
                if t["name"] == "Alpha Team":
                    team_id = t["id"]
        if not team_id:
            print("  WARN could not find existing team, skipping team setup")
    else:
        _ok(status, resp, "create team")
        team_id = None

    # Add members to team
    if team_id:
        for email in created_users:
            uid = created_users[email]
            s, r = post(f"{base_url}/api/v1/teams/{team_id}/members", {
                "user_id": uid, "weekly_capacity": 32
            }, token=token)
            if s == 409:
                pass  # already member
            elif not _ok(s, r, f"add member {email}"):
                pass
        print(f"  Added {len(created_users)} members to Alpha Team")

    # ------------------------------------------------------------------
    # Create a sample project
    # ------------------------------------------------------------------
    print("\n[7] Creating demo project...")
    status, resp = post(f"{base_url}/api/v1/projects", {
        "name": "Phoenix Initiative",
        "description": "Rebuild the core platform. Make it fast, clear, and actually useful.",
    }, token=token)
    if status in (200, 201):
        project_id = resp["data"]["id"]
        print(f"  OK project -> {project_id}")
    elif status == 409:
        print("  SKIP project (already exists -- fetching ID)")
        s2, r2 = get(f"{base_url}/api/v1/projects", token=token)
        project_id = None
        if _ok(s2, r2, "list projects"):
            for p in r2.get("data", []):
                if p["name"] == "Phoenix Initiative":
                    project_id = p["id"]
    else:
        _ok(status, resp, "create project")
        project_id = None

    # Attach team to project
    if project_id and team_id:
        s, r = post(f"{base_url}/api/v1/projects/{project_id}/teams", {
            "team_id": team_id
        }, token=token)
        if s not in (200, 201, 409):
            _ok(s, r, "attach team to project")
        else:
            print(f"  Team attached to project")

    # ------------------------------------------------------------------
    # Create epics
    # ------------------------------------------------------------------
    print("\n[8] Creating epics...")
    epics = [
        ("Foundation",    "Go project, Docker, CI, migrations. The boring stuff that makes everything else possible."),
        ("Auth & Users",  "Login, JWT, refresh tokens, roles, password change flows."),
        ("Teams",         "Team management, skill matrix, capacity planning."),
        ("Backlog",       "Stories, defects, tasks, tests. The heart of the system."),
        ("Sprint Board",  "Kanban board, drag-and-drop, sprint planning."),
    ]
    epic_ids = []
    for title, description in epics:
        if not project_id:
            break
        s, r = post(f"{base_url}/api/v1/projects/{project_id}/epics", {
            "title": title,
            "description": description,
        }, token=token)
        if s in (200, 201):
            epic_ids.append(r["data"]["id"])
            print(f"  OK epic '{title}'")
        else:
            print(f"  SKIP epic '{title}' (HTTP {s})")

    # ------------------------------------------------------------------
    # Create backlog items under first epic
    # ------------------------------------------------------------------
    print("\n[9] Creating backlog items...")
    backlog_items = [
        ("story",   "User can log in with email and password",   "A",  "done",        "As a user I want to log in so that I can access the platform."),
        ("story",   "User can change their password",            "B",  "done",        "All users with must_change_password flag are redirected to change-password page."),
        ("story",   "Admin can create new users",                "B",  "done",        "Admin creates users via the Users page. New users must change password on first login."),
        ("story",   "Team skill radar chart",                    "C",  "in_progress", "Show aggregated skill levels on the team detail page as a radar chart."),
        ("story",   "Sprint board with drag-and-drop",           "C",  "in_progress", "Move backlog items between sprint columns by dragging."),
        ("defect",  "Theme not persisting across logins",        "B",  "done",        "Selected theme was not saved to DB when theme name was unknown to backend validThemes map."),
        ("story",   "Backlog inline editing",                    "D",  "new",         "Double-click a row in the backlog table to edit title, sprint, epic, estimate inline."),
        ("story",   "Export sprint to CSV",                      "E",  "new",         "Download sprint items as a CSV file for external reporting."),
    ]
    epic_id_for_backlog = epic_ids[0] if epic_ids else None

    for item_type, title, complexity, status_val, description in backlog_items:
        if not project_id:
            break
        body = {
            "title":       title,
            "description": description,
            "item_type":   item_type,
            "complexity":  complexity,
            "status":      status_val,
        }
        if epic_id_for_backlog:
            body["epic_id"] = epic_id_for_backlog
        s, r = post(f"{base_url}/api/v1/projects/{project_id}/backlog", body, token=token)
        if s in (200, 201):
            print(f"  OK [{item_type}] '{title}'")
        else:
            print(f"  SKIP '{title}' (HTTP {s}): {r.get('error', {}).get('message', r)}")

    # ------------------------------------------------------------------
    # Create a sprint
    # ------------------------------------------------------------------
    print("\n[10] Creating demo sprint...")
    if team_id:
        s, r = post(f"{base_url}/api/v1/teams/{team_id}/sprints", {
            "name":       "Sprint 1",
            "start_date": "2026-06-01",
            "end_date":   "2026-06-14",
        }, token=token)
        if s in (200, 201):
            print(f"  OK sprint -> {r['data']['id']}")
        elif s == 409:
            print("  SKIP sprint (already exists)")
        else:
            print(f"  WARN sprint: HTTP {s}")

    print("\n" + "=" * 60)
    print("Demo seed complete.")
    print()
    print("Users created (all must change password on first login):")
    print(f"  admin        -> {admin_email} / (your SEED_ADMIN_PASSWORD)")
    for email, password, display_name, role in DEMO_USERS:
        print(f"  {role:<12} -> {email} / {password}")
    print()
    print("Log in at http://localhost (or your configured FRONTEND_PORT).")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import os

    parser = argparse.ArgumentParser(description="V.42 demo seed script")
    parser.add_argument("--base-url",       default=os.getenv("V42_BASE_URL", DEFAULT_BASE_URL))
    parser.add_argument("--admin-email",    default=os.getenv("SEED_ADMIN_EMAIL", "admin@example.com"))
    parser.add_argument("--admin-password", default=os.getenv("SEED_ADMIN_PASSWORD", ""))
    args = parser.parse_args()

    if not args.admin_password:
        print("ERROR: --admin-password is required (or set SEED_ADMIN_PASSWORD env var)")
        sys.exit(1)

    seed(args.base_url, args.admin_email, args.admin_password)
