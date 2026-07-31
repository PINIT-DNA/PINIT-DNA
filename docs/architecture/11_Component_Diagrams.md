# 11 — Component Diagrams

Mermaid component views of the running system.

---

## 1. Application architecture

```mermaid
flowchart TB
  subgraph Clients
    SPA[PinIT Hub React SPA]
    EXT[Chrome Extension MV3]
    PUB[Public Share Viewer]
  end

  subgraph API_Monolith[Express Monolith]
    RT[Routers]
    CTL[Controllers]
    MW[Auth Ownership Feature Upload]
    SVC[Domain Services]
    SCH[Schedulers + Crawler Engine]
  end

  subgraph DataPlane
    PG[(PostgreSQL)]
    SS[Supabase Storage]
    FS[Local vault FS]
  end

  subgraph Aux
    AI[Python AI]
    TIKA[Apache Tika]
    RZ[Razorpay]
  end

  SPA --> RT
  EXT --> RT
  PUB --> RT
  RT --> MW --> CTL --> SVC
  SCH --> SVC
  SVC --> PG
  SVC --> SS
  SVC --> FS
  SVC --> AI
  SVC --> TIKA
  SVC --> RZ
```

---

## 2. Folder hierarchy (runtime-relevant)

```mermaid
flowchart TD
  ROOT[Pinit-DNA]
  ROOT --> SRC[src]
  ROOT --> CLIENT[client]
  ROOT --> PY[python-ai]
  ROOT --> EXT[extension]
  ROOT --> PRISMA[prisma]
  ROOT --> DOCS[docs/architecture]

  SRC --> API[api/routes controllers middleware]
  SRC --> SVCS[services/*]
  SRC --> CFG[config]
  SRC --> LIB[lib]

  CLIENT --> PAGES[pages]
  CLIENT --> COMP[components]
  CLIENT --> ADM[admin]
  CLIENT --> SVCUI[services + hooks + context]
```

---

## 3. Authentication components

```mermaid
flowchart LR
  UI[Auth UI / Face capture] --> AUTHAPI[/api/v1/auth]
  AUTHAPI --> AC[auth.controller / face-auth.controller]
  AC --> AS[authService / biometricAuthService]
  AS --> JWT[jsonwebtoken]
  AS --> RT[(refresh_tokens)]
  AS --> US[(users)]
  AS --> BIO[(biometric_* tables)]
  MW[requireAuth] --> AS
  EXT[Extension] --> CODE[/auth/extension/*]
  CODE --> PGCTRL[publish-guardian.controller]
```

---

## 4. Database components

```mermaid
flowchart TB
  PRISMA[Prisma Client] --> DNA[DnaRecord + Layers]
  PRISMA --> VAULT[VaultRecord]
  PRISMA --> SHARE[ShareLink + AccessLog]
  PRISMA --> USER[User + Auth tables]
  PRISMA --> ORG[Organization graph]
  PRISMA --> SUB[Subscription + Plan]
  PRISMA --> MON[Monitor + Crawler]
  PRISMA --> PGPOST[ProtectedPost + Asset]
  PRISMA --> EV[Evidence + Incident + TEP]
```

---

## 5. API flow components

```mermaid
flowchart LR
  C[Client] --> APP[app.ts middleware]
  APP --> R[Router module]
  R --> M[Middleware chain]
  M --> CTRL[Controller]
  CTRL --> S[Service module]
  S --> P[Prisma]
  S --> X[External HTTP]
```

---

## 6. Upload flow components

```mermaid
flowchart TD
  Browser --> Multer[upload.middleware / route-local multer]
  Multer --> Temp[UPLOAD_TEMP_DIR or memory]
  Temp --> Detector[file-type-detector / UniversalFileRouter]
  Detector --> DNA[DNA engines / layers]
  Detector --> VaultPipe[vault identity + encrypt]
  VaultPipe --> Store[supabase-storage or local FS]
  DNA --> DB[(dna_records + layers)]
  VaultPipe --> VDB[(vault_records)]
```

---

## 7. Notification flow components

```mermaid
flowchart LR
  Domain[Account/Share/Platform events] --> PE[platform-events services]
  PE --> NDB[(notifications)]
  PE --> Hub[realtimeHub]
  Hub --> SSE[/notifications/stream]
  SSE --> Bell[NotificationBell UI]
  Bell --> REST[/notifications CRUD]
```

**Email component:** Not implemented.
