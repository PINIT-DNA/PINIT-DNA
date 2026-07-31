# 08 — Request Flow

End-to-end request paths as implemented in the monorepo.

---

## 1. Canonical stack

```
Browser
  ↓
Frontend (React / Vite)
  ↓
HTTP API (/api/v1) — Express
  ↓
Middleware (CORS, rate limit, auth, ownership, feature, multer)
  ↓
Controller
  ↓
Service
  ↓
Prisma (no separate Repository layer)
  ↓
PostgreSQL
  ↓
Response JSON / file stream
```

Optional side calls from Service: Supabase Storage, Python AI, Tika, Razorpay, crawler provider APIs.

---

## 2. Generic authenticated JSON request

```mermaid
sequenceDiagram
  participant B as Browser
  participant F as React page/hook
  participant A as axios api (dashboard.api)
  participant E as Express
  participant M as requireAuth + guards
  participant C as Controller
  participant S as Service
  participant P as Prisma
  participant DB as PostgreSQL

  B->>F: User action
  F->>A: api.get/post(...)
  A->>A: Attach Bearer access token
  A->>E: HTTPS /api/v1/...
  E->>E: Helmet, CORS, Morgan, body parser, rate limit
  E->>M: Route middleware chain
  M->>C: req.user set
  C->>S: business method
  S->>P: find/create/update
  P->>DB: SQL
  DB-->>P: rows
  P-->>S: models
  S-->>C: domain result
  C-->>A: { success, data }
  A-->>F: data
  F-->>B: UI update
```

---

## 3. Frontend → Backend → Database (dev)

```mermaid
flowchart TD
  UI[localhost:3000 Vite] -->|/api proxy| BE[localhost:4000 Express]
  BE --> MW[Middleware]
  MW --> CTRL[Controller]
  CTRL --> SVC[Service]
  SVC --> PRISMA[PrismaClient]
  PRISMA --> PG[(DATABASE_URL Postgres)]
  SVC --> SB[Supabase Storage optional]
  SVC --> AI[localhost:8001 Python AI]
```

---

## 4. Login flow (shortId)

```mermaid
sequenceDiagram
  participant UI as LoginFlow
  participant API as POST /auth/login
  participant Ctrl as authController
  participant Svc as authService
  participant DB as users + refresh_tokens

  UI->>API: { shortId }
  API->>Ctrl: login
  Ctrl->>Svc: loginWithId
  Svc->>DB: find user by shortId
  Svc->>DB: insert RefreshToken
  Svc-->>Ctrl: user + access + refresh
  Ctrl-->>UI: success data
  UI->>UI: localStorage tokens
```

---

## 5. DNA generate + vault store

```mermaid
sequenceDiagram
  participant UI as GeneratePage / App.tsx
  participant DNA as POST /dna/generate
  participant VLT as POST /vault/store
  participant Orch as dna.orchestrator / engines
  participant Vault as vault.service
  participant DB as Prisma
  participant ST as Storage

  UI->>DNA: multipart image + Bearer
  DNA->>Orch: generate layers
  Orch->>DB: DnaRecord + layer rows
  DNA-->>UI: dnaRecordId + metadata
  UI->>VLT: multipart / store params
  VLT->>Vault: encrypt
  Vault->>ST: upload .enc
  Vault->>DB: VaultRecord
  VLT-->>UI: vault id
```

---

## 6. Public share access

```mermaid
sequenceDiagram
  participant V as Viewer browser
  participant SPA as /s/:token or ShareViewerPage
  participant API as /api/v1/share/:token/*
  participant Svc as share-link.service
  participant DB as ShareLink + ShareAccessLog

  V->>SPA: Open link
  SPA->>API: GET /:token
  API->>Svc: load link policy
  Svc->>DB: findUnique token
  API-->>SPA: link info
  SPA->>API: POST /:token/access
  API->>DB: insert access log
  SPA->>API: GET /:token/file (after OTP/policy)
  API-->>V: file bytes
```

---

## 7. Error path

```mermaid
flowchart TD
  C[Controller / Service throw] --> N[next err or async rejection]
  N --> EM[errorMiddleware]
  EM --> D{Error type?}
  D -->|AppError / domain| R4[4xx/5xx JSON with message]
  D -->|Multer| R400[400]
  D -->|Vault/Supabase down| R503[503]
  D -->|Unknown| R500[500 Internal server error]
```

---

## 8. SSE notification path

```mermaid
sequenceDiagram
  participant UI as NotificationBell
  participant SSE as GET /notifications/stream
  participant Auth as requireAuthSse
  participant Hub as realtimeHub
  participant DB as Notification

  UI->>SSE: EventSource + Bearer or ?token=
  SSE->>Auth: verify JWT
  Auth->>Hub: subscribe user channel
  Note over Hub: Domain events persist Notification then push
  Hub-->>UI: SSE event
  UI->>UI: refresh list via REST
```

---

## 9. Layer mapping reminder

| Doc layer name | Actual code |
|----------------|-------------|
| API | `src/api/routes` |
| Controller | `src/api/controllers` |
| Service | `src/services/**` |
| Repository | **Not implemented** — Prisma in services |
| Database | PostgreSQL via Prisma |
| Storage | Supabase / local vault dir |
