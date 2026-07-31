# 07 — API Documentation

**Base path:** `/api/v1` (configurable via `API_PREFIX`)  
**Default content type:** `application/json`  
**Auth header:** `Authorization: Bearer <accessToken>` unless noted  
**Common success shape:** `{ "success": true, "data": ... }`  
**Common error shape:** `{ "success": false, "error": "..." }`

Status codes used across the API (typical):

| Code | Meaning |
|------|---------|
| 200 | OK |
| 201 | Created |
| 207 | Health degraded (`/health`) |
| 400 | Validation / bad request |
| 401 | Missing/invalid auth |
| 403 | Forbidden (role, ownership, feature) |
| 404 | Not found |
| 413/400 | Upload too large / Multer errors |
| 429 | Rate limited |
| 500 | Internal error |
| 503 | Dependency unavailable (vault/Supabase/AI) |

Where request/response bodies are not centralized in OpenAPI, fields below are taken from controllers/services as implemented. Fields marked *varies* mean the handler returns a rich domain object without a single shared DTO file.

---

## Health & meta

### `GET /api/v1/ping`
- **Purpose:** Liveness (no DB)
- **Auth:** None
- **Response:** `{ ok: true, service: "pinit-dna-api", ts: number }`
- **Status:** 200

### `GET /api/v1/health` and `GET /health`
- **Purpose:** Detailed health report
- **Auth:** None
- **Response:** health report object (`getHealthReport`)
- **Status:** 200 healthy / 207 degraded / 503 unhealthy

### `GET /s/:token`
- **Purpose:** SPA HTML with dynamic OG tags for share previews
- **Auth:** None
- **Response:** `text/html`
- **Status:** 200 or 404 if no React build

---

## Auth — `/api/v1/auth`

### `POST /auth/create`
- **Purpose:** Create account + shortId + tokens
- **Auth:** None
- **Body:** none required
- **Response 201:** `{ success, data: { user, accessToken, refreshToken } }`

### `POST /auth/login`
- **Purpose:** Login with shortId
- **Auth:** None
- **Body:** `{ "shortId": "PINIT-XXXXXXXX", "deviceFingerprint"?: string }`
- **Response 200:** `{ success, data: { user, accessToken, refreshToken } }`
- **Errors:** 400 missing shortId; 401 invalid id

### `POST /auth/refresh`
- **Body:** `{ "refreshToken": "..." }`
- **Response:** `{ success, data: { accessToken, refreshToken } }`
- **Errors:** 400 / 401

### `POST /auth/logout`
- **Body:** `{ "refreshToken"?: "..." }`
- **Response:** `{ success: true }`

### `GET /auth/me`
- **Auth:** Required
- **Response:** `{ success, data: req.user }`

### `POST /auth/account-type`
- **Auth:** Required
- **Body:** `{ "accountType": "INDIVIDUAL"|"BUSINESS", "organizationName"?: string }`
- **Errors:** 400 invalid accountType

### `POST /auth/business-setup`
- **Auth:** Required
- **Body:** `{ organizationName, industry?, organizationSize?, workspaceName? }`
- **Errors:** 400 if organizationName missing

### `GET /auth/business-setup/status`
- **Auth:** Required
- **Response:** setup status object

### `POST /auth/face/register`
- **Auth:** None (rate limited `biometricLimiter`)
- **Body:** face template payload (biometric controller)
- **Purpose:** Register face biometric

### `POST /auth/face/login`
- **Auth:** None (rate limited)
- **Purpose:** Login via face match → tokens

### `GET /auth/face/status`
- **Auth:** Required
- **Purpose:** Whether face is enrolled

### `POST /auth/extension/issue-code`
- **Auth:** Required
- **Purpose:** Issue one-time extension auth code

### `POST /auth/extension/token`
- **Auth:** None
- **Purpose:** Exchange extension code for tokens

---

## DNA — `/api/v1/dna`

| Method | Path | Auth | Extra | Purpose |
|--------|------|------|-------|---------|
| GET | `/` | Yes | — | List DNA records for user |
| GET | `/supported-types` | No | — | Supported MIME/engine matrix |
| GET | `/duplicate-attempts` | Yes | — | Duplicate upload attempts |
| GET | `/storage-audit` | Yes | — | DNA storage audit |
| POST | `/generate` | Yes | `uploadSingle` | Generate DNA from file field `image` |
| POST | `/recover-ownership` | Yes | upload | Recover ownership from image |
| POST | `/compare` | Yes | `uploadComparison` | Compare two files |
| POST | `/auto-compare` | Yes | upload | Probe vs vault auto-match |
| POST | `/generate-lightweight-dna` | Yes | upload | Phase-2 lightweight DNA |
| POST | `/compare-lightweight-dna` | Yes | JSON | Compare lightweight DNA |
| POST | `/extract-image-fingerprint` | Yes | upload | Image fingerprint extract |
| POST | `/extract-video-fingerprint` | Yes | upload | Video fingerprint |
| POST | `/extract-audio-fingerprint` | Yes | upload | Audio fingerprint |
| POST | `/:id/verify` | Yes | ownership + upload | Verify probe against record |
| GET | `/:id` | Yes | ownership | Get DNA record |

**Example — generate**

```http
POST /api/v1/dna/generate
Authorization: Bearer <token>
Content-Type: multipart/form-data

image=<file>
```

**Response:** `{ success: true, data: <GenerateDnaResponse varies> }`

**Verify body (Zod):** optional `{ layers?: string[] }` plus uploaded probe file.

---

## Vault — `/api/v1/vault`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Yes | List vault records |
| GET | `/integrity-check` | Yes | Blob integrity report |
| GET | `/protected-shares` | Yes | List protected file shares |
| POST | `/local-dna/backfill` | Yes | Backfill local DNA index |
| POST | `/store` | Yes + upload | Encrypt & store |
| POST | `/reanalyze-all` | Yes | Reanalyze vault content |
| GET | `/:id` | Yes + ownership | Get record |
| PATCH | `/:id/rename` | Yes + ownership | Rename |
| DELETE | `/:id` | Yes + ownership | Delete |
| GET | `/:id/preview` | Yes + ownership | Preview bytes/stream |
| POST | `/:id/retrieve` | Yes + ownership | Decrypt retrieve |
| POST | `/:id/analyze-content` | Yes + ownership | Content analysis |
| POST | `/:id/protected-download/prepare` | Yes + ownership | Prepare TEP/protected download |
| POST | `/:id/protected-download` | Yes + ownership | Execute protected download |
| GET | `/:id/tracking` | Yes + ownership | Tracking data |
| POST | `/:id/tep/:tepCode/revoke` | Yes + ownership | Revoke TEP |
| POST | `/:id/scan-sensitive` | Yes + ownership | Sensitive scan |
| POST | `/verify-identity` | upload (public) | Verify file identity |
| POST | `/scan-verify` | Yes | Scan-verify (inline route handler) |

**Example store**

```http
POST /api/v1/vault/store
Authorization: Bearer <token>
Content-Type: multipart/form-data
```

---

## Share — `/api/v1/share`

### Owner / authenticated

| Method | Path | Feature / notes |
|--------|------|-----------------|
| POST | `/` | Create share link (`FEATURE_SMART_SHARE`) |
| POST | `/file` | Create file share |
| GET | `/` | List share links |
| GET | `/vault/:vaultId` | Links for vault (ownership) |
| GET | `/timeline/:dnaId` | Share timeline (DNA ownership) |
| GET | `/analytics/geo` | Geo analytics (`FEATURE_TRACKING`) |
| GET | `/analytics/global` | Global stats |
| GET | `/analytics/live-map` | Live map |
| POST | `/forensics/attribute-leak` | Leak attribution upload (`FEATURE_INVESTIGATION`) |
| GET | `/sessions/live` | Live sessions |
| GET | `/debug/report` | Diagnostic report |
| GET | `/unmask-requests` | Owner unmask queue |
| POST | `/unmask-requests/:id/review` | Approve/reject |
| GET | `/:token/logs` | Access logs (tracking + ownership) |
| GET | `/:token/export` | CSV export |
| DELETE | `/:token` | Revoke |
| POST | `/:token/block-viewer` | Block viewer |
| DELETE | `/:token/block-viewer/:blockId` | Unblock |
| POST | `/:token/force-logout` | Force logout sessions |
| GET | `/:token/tree` | Link tree |

### Public token endpoints (no JWT)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/:token` | Link info |
| POST | `/:token/access` | Record access |
| POST | `/:token/share-further` | Forward share |
| POST | `/:token/verify-otp` | OTP verify |
| GET | `/:token/file` | Serve shared file |
| GET | `/:token/preview.png` | OG preview image |
| GET | `/:token/masked-text` | Masked content |
| POST | `/:token/unmask-request` | Request unmask |
| GET | `/:token/unmask-status` | Unmask status |

**Note:** Share OTP is verified in-app; **SMTP email delivery is not implemented**.

---

## Subscription — `/api/v1/subscription`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/me` | Yes | Current subscription |
| GET | `/plans` | Yes | List plans |
| GET | `/billing/config` | Yes | Razorpay/public billing config |
| POST | `/billing/create-order` | Yes | Create Razorpay order |
| POST | `/billing/verify` | Yes | Verify payment signature |
| GET | `/billing/history` | Yes | Billing history |
| POST | `/billing/mock-complete` | Yes | Mock payment complete (dev/test path) |
| POST | `/assign` | Yes | Assign plan |
| POST | `/admin/assign` | Yes + admin/super | Admin assign |

---

## Organization — `/api/v1/organization`

All require auth unless noted.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/me` | Current org |
| POST | `/setup` | Complete setup |
| PATCH | `/profile` | Update profile |
| POST | `/logo` | Upload logo (multipart) |
| POST | `/welcome/skip` | Skip welcome |
| GET | `/billing` | Billing summary |
| GET | `/team` | Team summary |
| GET | `/team/members` | Members |
| GET | `/team/invites` | Invites |
| POST | `/team/invite` | Invite |
| POST | `/team/accept` | Accept invite |
| DELETE | `/team/invites/:id` | Revoke invite |
| PATCH | `/team/members/:id/role` | Change role |
| DELETE | `/team/members/:id` | Remove member |
| GET/POST | `/workspaces` | List / create |
| GET/POST | `/departments` | List / create |
| PATCH/DELETE | `/departments/:id` | Update / delete |
| GET | `/audit-logs` | Org audit |
| GET/POST | `/api-keys` | List / create |
| DELETE | `/api-keys/:id` | Revoke key |
| GET/POST | `/webhooks` | List / create |
| PATCH/DELETE | `/webhooks/:id` | Update / delete |
| POST | `/webhooks/:id/test` | Test webhook |
| GET | `/integrations` | List |
| POST | `/integrations/slack` (+ `/test`) | Connect / test |
| POST | `/integrations/teams` (+ `/test`) | Connect / test |
| POST | `/integrations/zapier` (+ `/test`) | Connect / test |
| POST | `/integrations/dropbox` (+ `/test`) | Connect / test |
| POST | `/integrations/google-drive` (+ `/test`) | Connect / test |
| DELETE | `/integrations/:provider` | Disconnect |

---

## Admin — `/api/v1/admin`

Router-level: `requireAuth` + `requireAdmin` (**ADMIN** role).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/stats` | Admin stats |
| GET | `/users` | List users |
| GET | `/users/:id` | User detail |
| GET | `/vault` | All vault files (admin scope) |
| GET | `/activity` | Activity |
| POST | `/users/:id/role` | Update role |
| POST | `/users/:id/toggle` | Toggle active |

---

## Super Admin — `/api/v1/super-admin`

Router-level: `requireAuth` + `requireSuperAdmin`.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/overview` | Executive overview |
| GET | `/health` | System health |
| GET | `/users` | All users |
| GET | `/users/:id` | Profile |
| POST | `/users/:id/role` | Role update |
| POST | `/users/:id/toggle` | Toggle active |
| GET | `/vault` | All vault |
| GET | `/vault/:id/intelligence` | Vault intelligence |
| GET | `/vault/:id/tracking` | Tracking |
| GET | `/vault/:id/shares` | Shares |
| GET | `/vault/:id/timeline` | Timeline |
| GET | `/files` | Files explorer |
| GET | `/dna` | All DNA |
| GET | `/certificates` | All certificates |
| GET | `/investigations` | Investigations list |
| GET | `/tracking` | Tracking events |
| GET | `/monitoring` | Monitoring |
| GET | `/analytics` | Analytics |
| GET | `/activity` | Recent activity |
| GET | `/audit` | Audit logs |
| POST | `/unified-investigate` | Admin investigation (`uploadInvestigation`) |

---

## Evidence — `/api/v1/evidence`

| Method | Path | Auth / feature | Purpose |
|--------|------|----------------|---------|
| GET | `/public-key` | Public | Evidence public key |
| GET/POST | `/verify/:reportId` | Public | Verify signed report |
| POST | `/sign-manifest` | Auth + INVESTIGATION | Sign manifest |
| POST | `/report` | Auth + INVESTIGATION | Generate report |
| GET | `/records` | Auth + INVESTIGATION | List evidence |
| GET | `/records/:id` | Auth + INVESTIGATION | Get evidence |
| GET | `/incidents` | Auth + TRACKING | List incidents |
| GET | `/incidents/:id` | Auth + TRACKING | Get incident |
| PATCH | `/incidents/:id` | Auth + TRACKING | Update status |
| GET | `/recipients` | Auth | Recipients list |
| GET | `/chain/:dnaRecordId` | Auth | Forward chain |

---

## Forensic & investigation

### `POST /api/v1/forensic/diff`
- **Auth:** Required + `FEATURE_INVESTIGATION`
- **Upload:** comparison middleware (`fileA` / `fileB`)
- **Purpose:** Forensic diff

### `POST /api/v1/forensics/unified-investigate`
- **Auth:** Required + `FEATURE_INVESTIGATION`
- **Upload:** investigation upload (memory)
- **Purpose:** Unified investigation pipeline

---

## AI — `/api/v1/ai`

Proxies / orchestrates Python AI service.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | No | AI health |
| GET | `/stats` | Yes | Index stats |
| POST | `/embed` | Yes | Embed text/doc |
| POST | `/index/:dnaRecordId` | Yes | Index DNA doc |
| POST | `/search` | Yes | Semantic search |
| POST | `/duplicates` | Yes | Duplicate detect |
| POST | `/similar` | Yes | Similar docs |
| POST | `/reindex-all` | Yes | Reindex all |

---

## Monitoring — `/api/v1/monitor`

All: Auth + `FEATURE_TRACKING` (+ ownership where noted).

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/stats` | Monitoring stats |
| GET | `/engine/stats` | Crawler engine stats |
| POST | `/enroll-all` | Enroll all eligible |
| GET | `/` | List monitors |
| POST | `/enroll/:dnaRecordId` | Enroll (DNA ownership) |
| GET | `/alerts` | Alerts |
| POST | `/alerts/:id/dismiss` | Dismiss (alert ownership) |
| POST | `/alerts/:id/confirm` | Confirm |
| POST | `/:id/check` | Run check now |
| GET | `/:id/runs` | Run history |
| PATCH | `/:id/scan-type` | Update scan type |
| PATCH | `/:id/watch-urls` | Update watch URLs |
| POST | `/:id/pause` | Pause |
| POST | `/:id/resume` | Resume |
| DELETE | `/:id` | Stop/delete |

---

## Intelligence — `/api/v1/intelligence`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/ocr/:dnaRecordId` | Yes + DNA ownership | Run OCR |
| GET | `/search` | Yes | Semantic search |
| GET | `/lineage/:dnaRecordId` | Yes + ownership | Lineage graph |
| GET | `/duplicates` | Yes | Duplicates |
| GET | `/audit` | Yes | Audit log |
| GET | `/audit/export` | Yes | CSV export |
| GET | `/audit/:dnaRecordId` | Yes + ownership | Per-record audit |
| GET | `/report/:vaultId` | Yes + vault ownership | Intelligence report |
| GET | `/stats` | Yes | Stats |
| GET | `/debug/indexed` | Yes | Debug index |
| GET | `/tika/health` | No | Tika health |
| POST | `/tika/:dnaRecordId` | Yes + ownership | Tika extract |

---

## Certificates — `/api/v1/certificates`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/` | Yes | Issue certificate |
| GET | `/verify/:certificateId` | Public | Verify |
| POST | `/revoke/:certificateId` | Yes + ownership | Revoke |
| GET | `/` | Yes | List |
| GET | `/dna/:dnaRecordId` | Yes + DNA ownership | List by DNA |

---

## Recipients — `/api/v1/recipients`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/` | Yes | List |
| POST | `/` | Yes | Create |
| GET | `/:id` | Yes | Get |
| DELETE | `/:id` | Yes | Delete |

---

## Profile — `/api/v1/profile`

All auth required.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/` | Get profile |
| PUT | `/` | Update profile |
| PUT | `/notifications` | Notification prefs |
| PUT | `/password` | Change password |
| GET | `/stats` | Profile stats |
| GET | `/activity` | Activity timeline |
| GET | `/sessions` | Sessions |
| DELETE | `/session/:id` | Revoke session |
| DELETE | `/sessions` | Revoke all |

---

## Notifications — `/api/v1/notifications`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/stream` | `requireAuthSse` | SSE stream |
| GET | `/` | Yes | List |
| PUT | `/read-all` | Yes | Mark all read |
| PUT | `/:id/read` | Yes | Mark read |
| PUT | `/:id/archive` | Yes | Archive |
| DELETE | `/:id` | Yes | Delete |

---

## TEP — `/api/v1/tep`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/manifests` | Yes | List manifests |
| GET | `/:tepCode` | Yes | Get by code |

---

## Publish Guardian — mounted at `/api/v1`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/extension/publish-protect` | Yes + multer | Protect media for publish |
| POST | `/extension/register-post` | Yes | Register post |
| GET | `/extension/sync` | Yes | Sync extension state |
| GET | `/posts/stats` | Yes | Stats |
| GET | `/posts` | Yes | List protected posts |
| GET | `/posts/:id` | Yes | Get post |
| PATCH | `/posts/:id` | Yes | Update |
| DELETE | `/posts/:id` | Yes | Delete |

---

## Assets — mounted at `/api/v1`

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/assets/protect` | Yes + multer | Protect asset |
| GET | `/assets/stats` | Yes | Stats |
| GET | `/assets` | Yes | List |
| GET | `/assets/:id` | Yes | Get |
| PATCH | `/assets/:id/status` | Yes | Transition status |

---

## Python AI microservice (separate process)

Base: `AI_SERVICE_URL` (local `http://localhost:8001`). Not under Express `/api/v1`, but part of the platform.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Health |
| POST | `/embed` | Embedding |
| POST | `/index` | Index document |
| POST | `/search` | Search |
| POST | `/search/hybrid` | Hybrid search |
| POST | `/ocr` | OCR |
| POST | `/cv/compare` | CV compare |
| POST | `/cv/local-index` | Local index |
| POST | `/cv/match-descriptors` | Descriptor match |
| POST | `/cv/forensic-scan` | Forensic scan |
| POST | `/cv/forensic-index-tiles` | Tile index |
| POST | `/cv/forensic-features` | Features |
| POST | `/duplicates` | Duplicates |
| POST | `/similar` | Similar |
| GET | `/stats` | Stats |
| GET | `/debug/index` | Debug |
| DELETE | `/index/{dna_record_id}` | Delete index entry |

---

## Example authenticated request

```bash
curl -s https://<host>/api/v1/auth/me \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

## Example login

```bash
curl -s -X POST https://<host>/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"shortId":"PINIT-ABCD2345"}'
```

**Example response**

```json
{
  "success": true,
  "data": {
    "user": { "id": "...", "shortId": "PINIT-ABCD2345", "name": "PINIT User", "role": "USER" },
    "accessToken": "<jwt>",
    "refreshToken": "<jwt>"
  }
}
```

---

## OpenAPI

**Not implemented in current codebase** — no Swagger/OpenAPI spec file is generated from routes. This markdown is the endpoint inventory derived from route modules.
