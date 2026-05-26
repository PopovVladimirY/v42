#!/usr/bin/env bash
# Phase D end-to-end test
set -e
BASE=http://localhost:8080/api/v1

# Login
LOGIN=$(curl -s -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  --data-raw '{"email":"admin@v42.local","password":"changeme"}')
JWT=$(echo "$LOGIN" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['access_token'])")
echo "JWT obtained: ${JWT:0:20}..."

ADMIN_ID=$(curl -s "$BASE/auth/me" -H "Authorization: Bearer $JWT" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
echo "Admin ID: $ADMIN_ID"

# Create agent token
echo ""
echo "=== POST /agent-tokens ==="
RESP=$(curl -s -X POST "$BASE/agent-tokens" \
  -H "Authorization: Bearer $JWT" \
  -H 'Content-Type: application/json' \
  --data-raw "{\"user_id\":\"$ADMIN_ID\",\"name\":\"Claude on dev machine\"}")
echo "$RESP" | python3 -m json.tool

RAW=$(echo "$RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['raw_token'])")
echo ""
echo "Raw token: $RAW"

# List tokens
echo ""
echo "=== GET /agent-tokens ==="
curl -s "$BASE/agent-tokens" -H "Authorization: Bearer $JWT" | python3 -m json.tool

# Use agent token in auth/me
echo ""
echo "=== GET /auth/me with agent token ==="
curl -s "$BASE/auth/me" -H "Authorization: Bearer $RAW" | python3 -m json.tool

# Test readiness API
echo ""
echo "=== GET /projects/.../backlog/.../readiness ==="
PROJECT_ID="75b310d5-46b2-4f91-a6b0-fc8489054e35"
ITEMS=$(curl -s "$BASE/projects/$PROJECT_ID/backlog" -H "Authorization: Bearer $JWT")
ITEM_ID=$(echo "$ITEMS" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d[0]['id'] if d else 'NO_ITEMS')")
echo "Item ID: $ITEM_ID"
if [ "$ITEM_ID" != "NO_ITEMS" ]; then
  curl -s "$BASE/projects/$PROJECT_ID/backlog/$ITEM_ID/readiness" \
    -H "Authorization: Bearer $JWT" | python3 -m json.tool
fi

# Use in MCP
echo ""
echo "=== MCP list_projects with agent token ==="
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}' \
  | V42_API_TOKEN="$RAW" ~/v42/bin/v42-mcp 2>/dev/null
