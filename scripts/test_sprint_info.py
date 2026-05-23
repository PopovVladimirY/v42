#!/usr/bin/env python3
"""Quick test: verify sprint_name/sprint_id in backlog API response."""
import json
import urllib.request

BASE = "http://localhost:8080/api/v1"
PROJECT_ID = "75b310d5-46b2-4f91-a6b0-fc8489054e35"

# Login
req = urllib.request.Request(
    f"{BASE}/auth/login",
    data=json.dumps({"email": "admin@v42.local", "password": "changeme"}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as resp:
    token = json.loads(resp.read())["data"]["access_token"]

# Backlog list
req = urllib.request.Request(
    f"{BASE}/projects/{PROJECT_ID}/backlog",
    headers={"Authorization": f"Bearer {token}"},
)
with urllib.request.urlopen(req) as resp:
    items = json.loads(resp.read())["data"] or []

print(f"Total items: {len(items)}")
for item in items[:6]:
    sn = item.get("sprint_name")
    si = item.get("sprint_id")
    print(f"  B-{item['number']:02d} | sprint: {sn!r} | sprint_id: {si!r} | estimate: {item.get('estimate')!r}")

# Get single item detail
if items:
    item_id = items[0]["id"]
    req = urllib.request.Request(
        f"{BASE}/projects/{PROJECT_ID}/backlog/{item_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req) as resp:
        detail = json.loads(resp.read())["data"]
    print(f"\nDetail sprint_name: {detail.get('sprint_name')!r}")
    print(f"Detail sprint_id:   {detail.get('sprint_id')!r}")
