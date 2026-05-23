#!/usr/bin/env python3
"""Add backlog items to Sprint 1."""
import json
import urllib.request
import urllib.error

BASE_URL   = "http://localhost:8080/api/v1"
PROJECT_ID = "75b310d5-46b2-4f91-a6b0-fc8489054e35"
SPRINT_ID  = "a0eea9aa-689d-4d1e-8e78-c30c16765f40"

ITEM_IDS = [
    "c4a6ba51-7fd1-4e89-84d6-40187ed78ddd",
    "68e03d67-0022-42a3-8a9f-b00d6917c265",
    "1e32a334-ca03-4c70-8bbe-2260dc48c625",
    "d5d3d020-ec59-49b2-8395-7911ecefc8f7",
    "2cb1182a-6e78-46d4-bbd6-70e6cb4ae3dd",
    "681ce800-22a7-4e1a-b5f5-603f7effb61e",
    "e34b859b-18b0-4755-82e1-c91b0a29d030",
    "89887b90-db20-493a-b3cc-d5ef2117a6b8",
    "8700c060-3060-4f1e-bbbe-aa464abf5430",
    "c9e5d910-4a50-47c6-bb1a-d474176f939a",
    "24828ae9-22e8-47ec-bb0a-71fc3bc1581d",
    "bee3c1e0-0291-467d-ad14-b407262acab9",
    "cafe8889-8067-4066-9c48-399bdabb6b94",
]

req = urllib.request.Request(
    f"{BASE_URL}/auth/login",
    json.dumps({"email": "admin@v42.local", "password": "changeme"}).encode(),
    {"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(req) as r:
    token = json.loads(r.read())["data"]["access_token"]
print("Login OK")

added = 0
for i, bid in enumerate(ITEM_IDS):
    url  = f"{BASE_URL}/projects/{PROJECT_ID}/sprints/{SPRINT_ID}/items"
    body = json.dumps({"backlog_item_id": bid, "order_index": float(i + 1)}).encode()
    req  = urllib.request.Request(
        url, body,
        {"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as r:
            raw = r.read()
            d = json.loads(raw) if raw.strip() else {"ok": True}
            if d.get("data") or d.get("ok"):
                added += 1
                print(f"  OK {bid[:8]}...")
            else:
                print(f"  NO DATA: {d}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        print(f"  ERR {e.code}: {err[:120]}")

print(f"\nAdded {added}/{len(ITEM_IDS)} items to sprint {SPRINT_ID}")
