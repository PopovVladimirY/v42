#!/bin/bash
TOKEN=$(curl -sf -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@v42.local","password":"changeme"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["access_token"])')

echo "Token: ${TOKEN:0:30}..."

curl -sv -X POST \
  "http://localhost:8080/api/v1/projects/75b310d5-46b2-4f91-a6b0-fc8489054e35/backlog/b96ee2af-5d00-4a55-a8f2-4c9d7a5dc816/tasks" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"test task from curl"}' 2>&1 | tail -20
