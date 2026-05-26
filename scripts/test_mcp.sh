#!/usr/bin/env bash
# Quick smoke test for v42-mcp
set -e

BIN="${1:-$HOME/v42/bin/v42-mcp}"
TOKEN="${V42_API_TOKEN:-dummy}"

input=$(cat <<'EOF'
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
EOF
)

echo "$input" | V42_API_TOKEN="$TOKEN" "$BIN" | python3 -m json.tool --no-ensure-ascii 2>/dev/null || \
echo "$input" | V42_API_TOKEN="$TOKEN" "$BIN"
