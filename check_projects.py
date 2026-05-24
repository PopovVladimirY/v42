import urllib.request, json

data = json.dumps({'email':'admin@v42.local','password':'changeme'}).encode()
req = urllib.request.Request('http://localhost:8080/api/v1/auth/login', data=data, headers={'Content-Type':'application/json'})
resp = json.loads(urllib.request.urlopen(req).read())
token = resp['data']['access_token']
print("Logged in OK")

r2 = urllib.request.Request('http://localhost:8080/api/v1/projects?team_id=81af9417-d081-48db-bf78-d2b40bc0ed52', headers={'Authorization': 'Bearer '+token})
resp2 = json.loads(urllib.request.urlopen(r2).read())
projects = resp2.get('data', []) or []
print(f"Team projects count: {len(projects)}")
for p in projects:
    print(f"  {p['name']}: parent_id={p['parent_id']}")
