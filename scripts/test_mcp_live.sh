#!/usr/bin/env bash
# Live MCP test with real API token
set -e

# Login
RESP=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@v42.local","password":"changeme"}')

echo "Login response: $RESP" | head -c 200

TOKEN=$(echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data']['access_token'])" 2>&1)
echo "Token: ${TOKEN:0:20}..."

# Call list_projects via MCP
echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"list_projects","arguments":{}}}' \
  | V42_API_TOKEN="$TOKEN" "$HOME/v42/bin/v42-mcp" 2>/dev/null
