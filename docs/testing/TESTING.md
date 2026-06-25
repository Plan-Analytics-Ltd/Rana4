# Testing the Rana4 API

## Prerequisites

- Server running: `npm run dev` (in one terminal).
- Database: `DATABASE_URL` in `.env` pointing to your Neon (or local) PostgreSQL.
- For auth: run `npx prisma generate` and `npx prisma db push` once to create the `users` table. Set `JWT_SECRET` in `.env` (see `.env.example`).

---

## Option 1: Swagger UI (recommended)

With the server running in development, open **Swagger UI** in your browser:

**http://localhost:3000/api-docs**

There you can:

- See all endpoints (Health, Standards, Assurance notes, Fragnets, Activities, Relationships, Export).
- Try any request: expand an endpoint, click **Try it out**, fill parameters/body, then **Execute**.
- Inspect request and response.

Use this for manual, interactive testing. The same server handles both the API and the docs.

Swagger UI is intentionally disabled when `NODE_ENV=production`. The backend keeps a strict global CSP for API routes, with a CSP exception scoped only to `/api-docs` in non-production because Swagger UI ships inline scripts/styles and static assets that otherwise cannot render.

---

## Option 2: Automated script

With the server running, in another terminal:

```bash
npm run test:api
```

Or:

```bash
node scripts/validation/smoke/test-api.mjs
```

With a different base URL (e.g. PowerShell):

```powershell
$env:API_URL="http://localhost:3000"; node scripts/validation/smoke/test-api.mjs
```

The script runs a full flow: health → create standard, assurance note, fragnet, activities, relationship → GETs and export → checks 400/404 → deletes created data. Exits with code 0 if all pass, 1 otherwise.

---

## Option 3: Manual testing with PowerShell

Start the server (`npm run dev`), then run these in another PowerShell window. Replace `$base = "http://localhost:3000"` if needed.

### 1. Health

```powershell
$base = "http://localhost:3000"
Invoke-RestMethod -Uri "$base/health" -Method Get
# Expect: { status: "ok" }
```

### 2. Standards

```powershell
$standard = Invoke-RestMethod -Uri "$base/standards" -Method Post -Body (@{ name = "My Standard"; description = "Desc" } | ConvertTo-Json) -ContentType "application/json"
$standardId = $standard.id
Invoke-RestMethod -Uri "$base/standards" -Method Get
Invoke-RestMethod -Uri "$base/standards/$standardId" -Method Get
Invoke-RestMethod -Uri "$base/standards/$standardId" -Method Put -Body (@{ name = "Updated" } | ConvertTo-Json) -ContentType "application/json"
```

### 3. Assurance notes

```powershell
$note = Invoke-RestMethod -Uri "$base/assurance-notes" -Method Post -Body (@{ standardId = $standardId; noteText = "A note" } | ConvertTo-Json) -ContentType "application/json"
$noteId = $note.id
Invoke-RestMethod -Uri "$base/assurance-notes/standard/$standardId" -Method Get
```

### 4. Fragnets

```powershell
$fragnet = Invoke-RestMethod -Uri "$base/fragnets" -Method Post -Body (@{ standardId = $standardId; name = "My Fragnet"; description = "Frag" } | ConvertTo-Json) -ContentType "application/json"
$fragnetId = $fragnet.id
Invoke-RestMethod -Uri "$base/fragnets/standard/$standardId" -Method Get
Invoke-RestMethod -Uri "$base/fragnets/$fragnetId" -Method Get
```

### 5. Activities

```powershell
$a1 = Invoke-RestMethod -Uri "$base/activities" -Method Post -Body (@{ fragnetId = $fragnetId; activityCode = "A1"; name = "First"; bestDuration = 5; likelyDuration = 7 } | ConvertTo-Json) -ContentType "application/json"
$a2 = Invoke-RestMethod -Uri "$base/activities" -Method Post -Body (@{ fragnetId = $fragnetId; activityCode = "A2"; name = "Second"; bestDuration = 3; likelyDuration = 4 } | ConvertTo-Json) -ContentType "application/json"
$activity1Id = $a1.id
$activity2Id = $a2.id
Invoke-RestMethod -Uri "$base/activities/fragnet/$fragnetId" -Method Get
Invoke-RestMethod -Uri "$base/activities/$activity1Id" -Method Get
```

### 6. Relationships

```powershell
$rel = Invoke-RestMethod -Uri "$base/relationships" -Method Post -Body (@{ fragnetId = $fragnetId; predecessorActivityId = $activity1Id; successorActivityId = $activity2Id; relationshipType = "FS"; lag = 0 } | ConvertTo-Json) -ContentType "application/json"
$relId = $rel.id
Invoke-RestMethod -Uri "$base/relationships/fragnet/$fragnetId" -Method Get
```

### 7. Export

```powershell
Invoke-RestMethod -Uri "$base/export/fragnet/$fragnetId?scenario=best" -Method Get
Invoke-RestMethod -Uri "$base/export/fragnet/$fragnetId?scenario=likely" -Method Get
# Invalid scenario:
Invoke-RestMethod -Uri "$base/export/fragnet/$fragnetId?scenario=invalid" -Method Get
# Expect error/400
```

### 8. Cleanup (optional)

```powershell
Invoke-RestMethod -Uri "$base/relationships/$relId" -Method Delete
Invoke-RestMethod -Uri "$base/activities/$activity1Id" -Method Delete
Invoke-RestMethod -Uri "$base/activities/$activity2Id" -Method Delete
Invoke-RestMethod -Uri "$base/fragnets/$fragnetId" -Method Delete
Invoke-RestMethod -Uri "$base/assurance-notes/$noteId" -Method Delete
Invoke-RestMethod -Uri "$base/standards/$standardId" -Method Delete
```

---

## Option 4: curl (Git Bash / WSL)

```bash
BASE="http://localhost:3000"
curl -s "$BASE/health"
curl -s -X POST "$BASE/standards" -H "Content-Type: application/json" -d '{"name":"Test","description":"D"}'
# Use the returned id in subsequent calls...
curl -s "$BASE/export/fragnet/<fragnetId>?scenario=best"
```

---

## Quick checklist

| Area           | Endpoints to hit |
|----------------|------------------|
| Health         | GET /health      |
| Auth           | POST /auth/register, POST /auth/login, GET /auth/me (Bearer token), PUT /auth/me, PUT /auth/me/password |
| Standards      | POST, GET, GET/:id, PUT, DELETE |
| Assurance notes| POST, GET /standard/:standardId, DELETE |
| Fragnets       | POST, GET /standard/:standardId, GET/:id, PUT, DELETE |
| Activities     | POST, GET /fragnet/:fragnetId, GET/:id, PUT, DELETE |
| Relationships  | POST, GET /fragnet/:fragnetId, DELETE |
| Export         | GET /fragnet/:fragnetId?scenario=best \| likely |

Errors to verify: 400 (e.g. missing name, invalid scenario), 401 (missing/invalid token), 404 (wrong id), 500 (e.g. DB down).
