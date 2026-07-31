# 12 — Sequence Diagrams

---

## 1. Login (shortId)

```mermaid
sequenceDiagram
  actor U as User
  participant UI as LoginFlow
  participant API as POST /api/v1/auth/login
  participant S as authService
  participant DB as PostgreSQL

  U->>UI: Enter shortId
  UI->>API: { shortId, deviceFingerprint? }
  API->>S: loginWithId(shortId)
  S->>DB: SELECT user by shortId
  alt invalid / inactive
    API-->>UI: 401 Invalid User ID
  else ok
    S->>DB: UPDATE lastLoginAt
    S->>DB: INSERT refresh_tokens
    API-->>UI: user + accessToken + refreshToken
    UI->>UI: Persist tokens in localStorage
  end
```

---

## 2. Registration (create account)

```mermaid
sequenceDiagram
  actor U as User
  participant UI as RegistrationFlow
  participant API as POST /api/v1/auth/create
  participant S as authService
  participant DB as PostgreSQL
  participant EV as platform-events

  U->>UI: Complete registration UI
  UI->>API: POST /create
  API->>S: createAccount()
  S->>DB: INSERT users (generated shortId)
  S->>DB: INSERT refresh_tokens
  API->>EV: notifyUserRegistered
  API-->>UI: 201 + shortId + tokens
  UI->>UI: Store tokens; continue onboarding
```

Face registration is a separate sequence via `POST /auth/face/register` after or during biometric onboarding.

---

## 3. Upload (DNA generate)

```mermaid
sequenceDiagram
  participant UI as Generate / UploadZone
  participant API as POST /dna/generate
  participant MW as requireAuth + uploadSingle
  participant C as dna.controller
  participant O as DNA orchestrator / engines
  participant DB as Prisma

  UI->>API: multipart field image + Bearer
  API->>MW: auth + multer temp file
  MW->>C: req.file, req.user
  C->>O: generate for file type
  O->>DB: create DnaRecord + layers
  C-->>UI: DNA result payload
```

---

## 4. Download / retrieve (vault)

```mermaid
sequenceDiagram
  participant UI as VaultPage
  participant API as POST /vault/:id/retrieve
  participant MW as auth + requireVaultOwnership
  participant C as vault.controller
  participant V as vault.service
  participant ST as Supabase/local
  participant DB as VaultRecord

  UI->>API: retrieve request
  API->>MW: verify owner
  MW->>C: proceed
  C->>V: decrypt pipeline
  V->>DB: load metadata
  V->>ST: download .enc
  V-->>C: plaintext buffer/stream
  C-->>UI: file response
```

Protected download uses `/protected-download/prepare` then `/protected-download` (TEP-aware).

---

## 5. Sharing

```mermaid
sequenceDiagram
  participant Owner as Owner UI
  participant Create as POST /share
  participant Viewer as ShareViewer /s/:token
  participant Info as GET /share/:token
  participant Access as POST /share/:token/access
  participant File as GET /share/:token/file
  participant DB as ShareLink + logs

  Owner->>Create: create link (FEATURE_SMART_SHARE)
  Create->>DB: insert ShareLink
  Create-->>Owner: token + URL
  Viewer->>Info: load policy
  Info->>DB: find by token
  Viewer->>Access: record viewer metadata
  Access->>DB: ShareAccessLog
  opt OTP required
    Viewer->>Viewer: POST verify-otp
  end
  Viewer->>File: fetch bytes
  File-->>Viewer: content
```

---

## 6. Notifications

```mermaid
sequenceDiagram
  participant Domain as Domain service
  participant PE as platform-events
  participant DB as notifications
  participant Hub as realtimeHub
  participant UI as NotificationBell

  Domain->>PE: emit event
  PE->>DB: insert Notification
  PE->>Hub: push to user channel
  UI->>Hub: SSE /notifications/stream connected
  Hub-->>UI: event
  UI->>UI: GET /notifications refresh
```

---

## 7. Search

```mermaid
sequenceDiagram
  participant UI as SearchPage
  participant API as POST /ai/search or GET /intelligence/search
  participant Node as ai / intelligence controllers
  participant Py as Python AI /ai/search
  participant Idx as FAISS / index

  UI->>API: query
  API->>Node: handler
  Node->>Py: HTTP search
  Py->>Idx: vector query
  Py-->>Node: hits
  Node-->>UI: results
```

Exact path depends on UI calling AI routes vs intelligence routes — both exist.

---

## 8. Authentication (middleware on protected call)

```mermaid
sequenceDiagram
  participant UI as Any protected page
  participant AX as axios interceptor
  participant API as Protected endpoint
  participant Auth as requireAuth
  participant S as authService.verifyAccess

  UI->>AX: request
  AX->>AX: Authorization Bearer access
  AX->>API: HTTP
  API->>Auth: extract token
  Auth->>S: jwt.verify
  alt invalid
    Auth-->>AX: 401
    AX->>AX: POST /auth/refresh
    AX->>API: retry
  else valid
    Auth->>Auth: req.user = payload
    API-->>UI: 200 data
  end
```
