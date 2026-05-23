#!/usr/bin/env python3
"""
backlog_epics_ui.py -- Creates backlog items for EpicsPage UI improvements
and adds them to Sprint 1. Run from WSL: python3 scripts/backlog_epics_ui.py
"""
import json, sys
import urllib.request, urllib.parse

BASE     = "http://localhost:8080/api/v1"
EMAIL    = "admin@v42.local"
PASSWORD = "changeme"
PID      = "75b310d5-46b2-4f91-a6b0-fc8489054e35"

# ── helpers ──────────────────────────────────────────────────────────────────

def req(method, path, body=None, token=None):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:    return json.loads(raw)
        except: return {"error": str(e), "raw": raw.decode()}

# ── auth ─────────────────────────────────────────────────────────────────────

print("Logging in...")
resp = req("POST", "/auth/login", {"email": EMAIL, "password": PASSWORD})
TOKEN = resp["data"]["access_token"]
print("  OK")

# ── get sprint 1 ─────────────────────────────────────────────────────────────

sprints = req("GET", f"/projects/{PID}/sprints", token=TOKEN)["data"]
sprint1 = next((s for s in sprints if s["name"].lower().startswith("sprint 1")), None)
if not sprint1:
    print("Sprint 1 not found! Available:", [s["name"] for s in sprints])
    sys.exit(1)
SID = sprint1["id"]
print(f"Sprint 1: {SID} ({sprint1['name']})")

# ── get epics -- find Phase 5 ─────────────────────────────────────────────────

epics = req("GET", f"/projects/{PID}/epics", token=TOKEN)["data"]
phase5 = next((e for e in epics if "5" in e["title"] and ("table" in e["title"].lower() or "phase 5" in e["title"].lower() or "release" in e["title"].lower())), None)
if not phase5:
    # Fallback: just pick the first in_progress or open epic
    phase5 = next((e for e in epics if e["status"] in ("open", "in_progress")), epics[0])
EPIC_ID = phase5["id"]
print(f"Using epic: {EPIC_ID} ({phase5['title']})")

# ── backlog items ─────────────────────────────────────────────────────────────

ITEMS = [
    {
        "title": "EpicsPage: status color badges in table rows",
        "type": "story",
        "estimate": "1",
        "priority": 10,
        "ac_setup": "EpicsPage shows epics in a table. Each row has a Status cell.",
        "ac_steps": "Observe the Status cell for any epic row.",
        "ac_expected": "Status badge uses colored pill: open=gray, in_progress=accent, done=green, cancelled=red. Color matches STATUS_OPTS palette already used elsewhere.",
    },
    {
        "title": "EpicsPage: show only first line of description in table",
        "type": "story",
        "estimate": "1",
        "priority": 20,
        "ac_setup": "An epic has a multi-line or long description.",
        "ac_steps": "View the epics table.",
        "ac_expected": "Description column shows only the first 100 chars (or first newline), truncated with ellipsis. Full description visible in edit panel.",
    },
    {
        "title": "EpicsPage: filter bar (status, title, description search)",
        "type": "story",
        "estimate": "2",
        "priority": 30,
        "ac_setup": "Project has multiple epics with various statuses and titles.",
        "ac_steps": "1. Select a status in the filter dropdown. 2. Type a string in the search field.",
        "ac_expected": "Table filters in real-time. Status filter shows only matching rows. Text search matches title OR description (case-insensitive). Filters reset page to 1. Filter state persisted in localStorage per project.",
    },
    {
        "title": "EpicsPage: sortable columns (title, status)",
        "type": "story",
        "estimate": "2",
        "priority": 40,
        "ac_setup": "EpicsPage table has Title and Status columns.",
        "ac_steps": "Click the Title column header. Click again. Click the Status header.",
        "ac_expected": "First click sorts ascending, second descending. Sort direction indicator (arrow) shown in header. Status sort uses logical order: open -> in_progress -> done -> cancelled. Sort state resets page to 1.",
    },
    {
        "title": "EpicsPage: separate edit panel (title, description, status)",
        "type": "story",
        "estimate": "3",
        "priority": 50,
        "ac_setup": "User clicks on an epic title in the table.",
        "ac_steps": "1. Click epic title. 2. Edit title, description, status. 3. Save.",
        "ac_expected": "A side panel or inline panel expands below the row with a full edit form (title input, textarea for description with link support, status select). Save calls PATCH /epics/{id}. Cancel restores original. Description field accepts multiline text.",
    },
    {
        "title": "EpicsPage: resizable columns (layout saved to localStorage)",
        "type": "story",
        "estimate": "5",
        "priority": 60,
        "ac_setup": "EpicsPage table has multiple columns.",
        "ac_steps": "1. Drag the border between column headers to resize. 2. Reload the page.",
        "ac_expected": "Column widths are adjustable via drag on the header border. Layout (column widths) persisted in localStorage under key v42-epics-col-widths. On reload, widths restored. Minimum column width enforced (60px).",
    },
    {
        "title": "EpicsPage: manual drag-and-drop row reordering",
        "type": "story",
        "estimate": "8",
        "priority": 70,
        "ac_setup": "Project has multiple epics. No filters or sorts active.",
        "ac_steps": "1. Drag an epic row to a new position. 2. Release.",
        "ac_expected": "Row moves to new position visually. PATCH /projects/{id}/epics/reorder called with new order array. Order persisted. When sort is active, drag handle is hidden/disabled.",
    },
]

# ── create items and add to sprint ───────────────────────────────────────────

created = []
for item in ITEMS:
    payload = {
        "title":       item["title"],
        "type":        item["type"],
        "epic_id":     EPIC_ID,
        "estimate":    item.get("estimate"),
        "priority":    item.get("priority"),
        "ac_setup":    item["ac_setup"],
        "ac_steps":    item["ac_steps"],
        "ac_expected": item["ac_expected"],
    }
    r = req("POST", f"/projects/{PID}/backlog", payload, token=TOKEN)
    if "data" in r and r["data"]:
        iid = r["data"]["id"]
        created.append(iid)
        print(f"  + {item['title'][:60]}  [{iid[:8]}]")
    else:
        print(f"  ERR: {item['title'][:60]} -- {r}")

# ── add to sprint ─────────────────────────────────────────────────────────────

print(f"\nAdding {len(created)} items to Sprint 1 ({SID[:8]})...")
for iid in created:
    r = req("POST", f"/projects/{PID}/sprints/{SID}/items", {"backlog_item_id": iid}, token=TOKEN)
    if r.get("ok") or "data" in r:
        print(f"  -> {iid[:8]} added")
    else:
        print(f"  ERR {iid[:8]}: {r}")

print("\nDone!")
