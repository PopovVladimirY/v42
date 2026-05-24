#!/usr/bin/env python3
"""Mark completed EpicsPage tasks as done in V.42."""
import json, urllib.request

BASE  = "http://localhost:8080/api/v1"
PID   = "75b310d5-46b2-4f91-a6b0-fc8489054e35"

def req(method, path, body=None, token=None):
    data = json.dumps(body).encode() if body else None
    hdrs = {"Content-Type": "application/json"}
    if token: hdrs["Authorization"] = f"Bearer {token}"
    r = urllib.request.Request(BASE + path, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(r) as resp:
            raw = resp.read()
            return json.loads(raw) if raw.strip() else {"ok": True}
    except urllib.error.HTTPError as e:
        return {"error": e.read().decode()}

TOKEN = req("POST", "/auth/login", {"email": "admin@v42.local", "password": "changeme"})["data"]["access_token"]
items = req("GET", f"/projects/{PID}/backlog", token=TOKEN)["data"]

DONE_PREFIXES = [
    "EpicsPage: status color badges",
    "EpicsPage: show only first line",
    "EpicsPage: filter bar",
    "EpicsPage: sortable columns",
    "EpicsPage: separate edit panel",
]

for item in items:
    for prefix in DONE_PREFIXES:
        if prefix.lower() in item["title"].lower():
            r = req("PATCH", f"/projects/{PID}/backlog/{item['id']}", {"status": "done"}, token=TOKEN)
            ok = "error" not in r
            print(f"  {'OK' if ok else 'ERR'} {item['id'][:8]} | {item['title'][:55]}")
            break
