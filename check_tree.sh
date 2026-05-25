#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@v42.local","password":"changeme"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")

echo "=== Tree ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/projects/75b310d5-46b2-4f91-a6b0-fc8489054e35/tree" \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)['data']
for n in d:
    pid = n['parent_id'][:8] if n['parent_id'] else 'null'
    print(f\"  id={n['id'][:8]} parent_id={pid} name={n['name']}\")
"

echo ""
echo "=== Backlog item node_id ==="
curl -s -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/api/v1/projects/75b310d5-46b2-4f91-a6b0-fc8489054e35/backlog/2cb1182a-6e78-46d4-bbd6-70e6cb4ae3dd" \
  | python3 -c "
import sys,json
d = json.load(sys.stdin)['data']
print(f\"  node_id={d['node_id']} stage_id={d['stage_id']} sprint_id={d['sprint_id']}\")
"
