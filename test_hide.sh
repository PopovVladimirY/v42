#!/bin/bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@v42.local","password":"changeme"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["access_token"])')
echo "Token: ${TOKEN:0:30}..."

SKILLS=$(curl -s -X GET 'http://localhost:8080/api/v1/skills?all=true' \
  -H "Authorization: Bearer $TOKEN")
echo "$SKILLS" | python3 -c 'import sys,json; s=json.load(sys.stdin)["data"]; [print(x["id"],x["name"],x["is_hidden"]) for x in s[:5]]'

ID=$(echo "$SKILLS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"][0]["id"])')
echo "Testing hide on ID=$ID"

RES=$(curl -s -X PATCH "http://localhost:8080/api/v1/skills/$ID/hidden" \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"hidden":true}')
echo "PATCH result: $RES"
