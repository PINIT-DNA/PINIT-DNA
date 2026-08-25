# PINIT HUB — Business Client Collaboration & Asset Review Blueprint

**Document type:** Phase 1 repository inspection + implementation blueprint
**Audience:** Senior engineering
**Status:** Blueprint — **no code changed, no schema migration, no push, no deploy**
**Date:** 2026-08-25
**Branch inspected:** `ashwitha`
**Schema inspected:** `prisma/schema.prisma` — 2,268 lines, 84 models
**Published version:** https://claude.ai/code/artifact/d1e2c247-b473-423f-befb-483b2cbf9d79

**Governing principles**

1. Never allow a client to overwrite a protected asset. Collaboration happens *around* the asset.
2. Reuse before building. Roughly half of this specification already exists in the share layer.
3. Additive migrations only. No existing column altered or dropped.
4. Every existing share link must keep behaving exactly as it does today.
5. Protection (DNA / Vault / Certificate) stays untouched.

**Locked conceptual target**

```text
Organization
└── Client
    └── Campaign
        └── Asset
            ├── Protection      DNA · Vault · Certificate · Provenance   [EXISTS]
            ├── Secure Sharing  expiry · views · download · tracking     [EXISTS]
            └── Collaboration   versions · comments · approvals · chat   [TO BUILD]
```

---

## A. Current architecture

### A.1 The two scoping regimes

The most important structural fact, and the one the specification does not account for:
business entities and protection entities are scoped by **different keys**.

```text
Organization ──┬── Client ── Campaign ──┐   scoped by organizationId
               │                        │
               └── OrganizationMember   │   (RBAC lives here)
                                        │
                           Asset ◄──────┘   scoped by ownerUserId
                             │
                             ├── DnaRecord      ownerUserId
                             ├── VaultRecord    ownerUserId
                             └── Certificate    ownerUserId
```

`Campaign.organizationId` and `Asset.ownerUserId` are joined only by the nullable
`Asset.campaignId` column. Every new collaboration table must pick a regime.

**Decision: use `organizationId`**, matching the business layer the feature lives in,
with the asset relationship validated on write rather than trusted.

### A.2 What the inspection found

| Layer | Implementation | Location |
|---|---|---|
| Business API | 18 routes, all `requireAuth`; uniform `orgIdFor(req)` → `(userId, organizationId)` handoff | `src/api/routes/business.routes.ts`, `src/api/controllers/business.controller.ts` |
| RBAC | `requireOrgRole(userId, orgId, min)`; ordered roles OWNER · MANAGER · INVESTIGATOR · MEMBER · VIEWER | `src/services/organization/org-access.service.ts:58` |
| Event engine | `platformEvents.emit()` — one envelope fans out to notification, timeline and audit subscribers, with `skip*` flags | `src/services/platform-events/` |
| Realtime | SSE. `realtimeHub` is **in-process** pub/sub keyed by `userId` | `src/services/platform-events/realtime-hub.ts`, `src/api/controllers/notification.controller.ts:124` |
| Campaign activity | Reads `organizationAuditLog` where `entityType='campaign'` | `src/services/organization/campaign.service.ts:353` |
| Secure sharing | `ShareLink` — 60+ columns: OTP, expiry, view/download caps, geo·IP·device restriction, forwarding depth, watermarking, PII masking, revocation | `prisma/schema.prisma:1204` |
| Client messaging | `ShareViewerMessage` (`body`, `status`, `ownerReply`, `repliedAt`) — public POST + authenticated reply, both live | `src/api/routes/share.routes.ts:63,77` |
| Client identity | `ShareRecipient` — `recipientCode`, `trustScore`, known devices/IPs/countries, access counts | `prisma/schema.prisma:1314` |
| Secure viewer | 1,357 lines. DOCX via `docx-preview` into live DOM; images `<img>`; video `<video>`; **PDF via `<iframe>`** | `client/src/pages/ShareViewerPage.tsx` |
| UI kit | `BusinessPage`, `Breadcrumbs`, `SectionCard`, `StatTile`, `EmptyHint`, `SkeletonRows`, `SkeletonTiles`, `PageError`, `TabBar`, `ComingSoonPanel` | `client/src/components/business/clients/BusinessKit.tsx` |

### A.3 Corrections to the specification

- §4 assumes `/business/clients/:clientId/campaigns/:campaignId`.
  The **actual route is `/business/campaigns/:campaignId`** — flat, client resolved from the campaign record.
- Four campaign tabs are declared `soon: true` placeholders in
  `client/src/pages/business/CampaignWorkspacePage.tsx:92-97`:
  **Approvals, Versions, Rights, Intelligence**.

---

## B. Gap analysis

| Capability | Status | Detail |
|---|---|---|
| Secure access control | **EXISTS** | Expiry, view caps, download caps, revocation, device/IP/geo binding, forwarding depth, watermark, masking |
| Client identity | **EXISTS** | `ShareRecipient` + `requireOtp`/`otpVerified`. Sufficient to attribute an approval *provided OTP is enforced* |
| RBAC | **EXISTS** | `requireOrgRole` covers every internal role in §26 |
| Activity / audit | **EXISTS** | `platformEvents.emit()` + `organizationAuditLog`. §22's "do not duplicate" satisfied by emitting into this |
| Campaign ↔ asset link | **EXISTS** | `Asset.campaignId`, attached during protect at `src/api/controllers/vault.controller.ts:266`. No second uploader needed |
| Client → team messaging | **PARTIAL** | `ShareViewerMessage` works but is scoped **per share token**, not per campaign. Promote, do not rebuild |
| Realtime | **PARTIAL** | SSE exists but keyed by `userId` — **a client has no user row and cannot subscribe**. Also in-process only |
| Notifications | **PARTIAL** | `Notification` has `deepLink` and is solid, but is `userId`-scoped — reaches the team, never the client |
| Share link → campaign | **PARTIAL** | `ShareLink.assetId` exists, so campaign is derivable via `Asset.campaignId`. No review-permission columns yet |
| Asset version chain | **MISSING** | The critical gap. See B.1 |
| Comments & threads | **MISSING** | Nothing at asset or version level |
| Change requests | **MISSING** | Nothing exists |
| Approvals | **MISSING** | Nothing exists. Tab is a placeholder |
| Review state machine | **MISSING** | `AssetStatus` is a protection/monitoring lifecycle (DRAFT · PROTECTED · MONITORING · …), **not** a review lifecycle. Do not overload it |
| Email delivery | **MISSING** | **No mail library installed at all.** See B.2 |

### B.1 Do not repurpose `EvolutionLayer`

`EvolutionLayer` has a `version Int` field and looks like an existing version system.
It is not one.

It is keyed `dnaRecordId @unique` — one row per DNA record — and its `mutationLog`
tracks fingerprint mutation *within a single protected file*. It cannot express
"V1 → V2 → V3 of a deliverable", because each version is a distinct file with its own
DNA record.

Specification §15 says "use the existing Evolution/Version architecture if present."
The honest answer: it is present, and it is the wrong shape. **A new table is required.**

### B.2 Hard blocker — the client cannot be reached

`package.json` contains no mailer: no Nodemailer, SendGrid, Resend, Postmark, Mailgun
or SES. Share OTPs are generated and hashed at
`src/services/share/share-link.service.ts:301`, but **nothing delivers them**.

Specification §17, §21 and §41 all depend on notifying a client who has no account.
Without email, "Version 3 is ready for review" can only reach them by pasting the link
into WhatsApp by hand — which also means OTP-gated approval requires manually relaying
the code.

**This must be resolved before Phase 4 has any value.** It is a small job; it is just
currently invisible.

### B.3 PDF cannot carry comment anchors

Specification §12 asks for page-level and text-level anchors. Feasibility differs
sharply by media type, because the viewer renders each one differently:

| Type | Renderer | Anchor feasibility |
|---|---|---|
| Video | `<video>` | **Trivial** — `currentTime` float |
| Image | `<img>` | **Trivial** — normalised x/y, survives zoom |
| DOCX | `docx-preview` → live DOM | **Feasible** — page via section index; text via DOM Range |
| PDF | `<iframe src>` | **Not possible** — cross-document, opaque to script |

PDF anchoring would require replacing the iframe with `pdf.js` — meaningful work with
real regression risk to a viewer that currently works.

**Recommendation:** ship anchors for video, image and DOCX; allow unanchored comments
on PDF and revisit later.

### B.4 Anchors orphan across versions

A comment says "change this heading". V2 changes that heading. The anchor no longer
resolves. This is inherent to the workflow, not a bug, and the specification does not
address it.

**Decision:** store the quoted text on the comment itself and mark the anchor
`anchorOrphaned` on later versions. Never attempt to relocate it.

---

## C. Proposed data model

Four new models, four enums, five additive columns on `ShareLink`.
Nothing existing is altered destructively.

### C.1 `AssetVersion` — the keystone

Every other object in this feature references a version. This must land first.
Each version points at its own `DnaRecord`, `VaultRecord` and `Certificate`, so
protection stays exactly as it is today and history stays intact.

```prisma
model AssetVersion {
  id             String   @id @default(uuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  assetId        String                  // the logical deliverable
  versionNumber  Int                     // 1, 2, 3 …
  organizationId String                  // tenancy — see A.1
  campaignId     String?

  // Protection — one immutable set per version, never reused
  dnaRecordId      String?
  vaultId          String?
  certificateId    String?
  contentHash      String?
  originalFilename String
  mimeType         String
  sizeBytes        Int      @default(0)

  reviewStatus    ReviewStatus @default(DRAFT)
  changeSummary   String?  @db.Text
  createdByUserId String

  supersededAt   DateTime?
  supersededById String?  @unique

  @@unique([assetId, versionNumber])
  @@index([assetId, versionNumber])
  @@index([campaignId, reviewStatus])
  @@index([organizationId])
  @@map("asset_versions")
}
```

**Immutability is structural, not conventional.** Because each row carries its own
`dnaRecordId` and `vaultId`, a new version is an *insert*. There is no code path that
updates a prior version's protection columns. Specification §2 and acceptance
criterion 11 are satisfied by the shape of the table rather than by discipline.

### C.2 `ReviewComment` — comments and change requests in one table

Specification §13 correctly insists a change request is not merely a comment: it is
actionable and carries its own lifecycle. That distinction is preserved by a `kind`
discriminator rather than a second table — so the two behave differently in the UI and
in queries, while the team keeps one inbox and the client keeps one mental model.

```prisma
model ReviewComment {
  id             String   @id @default(uuid())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  organizationId String
  campaignId     String
  assetId        String
  versionId      String                  // always version-anchored

  kind           CommentKind   @default(COMMENT)
  status         CommentStatus @default(OPEN)
  parentId       String?                 // null = thread root

  // Authorship — exactly one of these is set
  authorUserId      String?              // internal
  authorRecipientId String?              // client, via ShareRecipient
  authorLabel       String               // display name, denormalised

  body           String   @db.Text
  anchor         Json?
  anchorOrphaned Boolean  @default(false)

  resolvedAt       DateTime?
  resolvedByUserId String?

  @@index([versionId, createdAt])
  @@index([assetId, versionId, createdAt])
  @@index([campaignId, status])
  @@index([parentId])
  @@map("review_comments")
}
```

The anchor stays a single extensible JSON column, exactly as §12 proposes:

```jsonc
{ "type": "page",       "page": 4 }
{ "type": "coordinate", "x": 0.42, "y": 0.71 }        // normalised 0–1
{ "type": "timestamp",  "seconds": 154.2 }
{ "type": "text", "page": 2, "quote": "Campaign Protection",
  "prefix": "…", "suffix": "…" }
```

### C.3 `VersionApproval` — the audit record

```prisma
model VersionApproval {
  id             String   @id @default(uuid())
  createdAt      DateTime @default(now())

  organizationId String
  campaignId     String
  assetId        String
  versionId      String

  decision       ApprovalDecision        // APPROVED | CHANGES_REQUESTED
  comment        String?  @db.Text

  // Identity evidence — what makes this defensible later
  approvedByUserId      String?
  approvedByRecipientId String?
  approverLabel         String
  shareToken            String?
  otpVerified           Boolean @default(false)
  deviceFingerprint     String?
  ipAddress             String?

  @@index([versionId, createdAt])
  @@index([campaignId, decision])
  @@map("version_approvals")
}
```

**Approval must be identity-bound, not link-bound.**
"Approved by Adhureddy, 25 Aug 2026, 3:42 PM" is an audit claim. If it rests only on
possession of a URL, anyone the link was forwarded to can make it — and `share-further`
is a supported feature at `depth > 0`.

**Recommendation:** require OTP for the *approve action specifically*, not for viewing.
Reading stays frictionless; only the act that carries weight is gated. This uses
machinery that already exists and honours §25's instruction not to introduce new
registration requirements — OTP is already part of this product.

### C.4 `CampaignMessage` — promoting what already works

```prisma
model CampaignMessage {
  id             String   @id @default(uuid())
  createdAt      DateTime @default(now())

  organizationId String
  campaignId     String
  assetId        String?                 // optional asset thread (§43)
  versionId      String?

  authorUserId      String?
  authorRecipientId String?
  authorLabel       String
  isSystem          Boolean @default(false)  // "Version 3 uploaded"

  body           String   @db.Text
  readByOwnerAt  DateTime?

  @@index([campaignId, createdAt])
  @@index([assetId, createdAt])
  @@map("campaign_messages")
}
```

### C.5 Enums

```prisma
enum ReviewStatus     { DRAFT  IN_REVIEW  CHANGES_REQUESTED
                        IN_PROGRESS  APPROVED  SUPERSEDED }
enum CommentKind      { COMMENT  CHANGE_REQUEST }
enum CommentStatus    { OPEN  IN_PROGRESS  RESOLVED  REJECTED  CLOSED }
enum ApprovalDecision { APPROVED  CHANGES_REQUESTED }
```

### C.6 Additive columns on `ShareLink`

Five nullable/defaulted columns. No existing column is touched, so every current share
link keeps working unchanged and defaults to view-only.

```prisma
reviewMode         Boolean @default(false)
allowComments      Boolean @default(false)
allowChangeRequest Boolean @default(false)
allowApproval      Boolean @default(false)
versionId          String?   // pins the link to a version
```

### C.7 The view-cap tension

A reviewing client opens the document, comments, returns for replies, then opens V2 —
that is half a 10-view budget spent on normal behaviour, and then they are locked out
mid-review.

**Decision:** a review link should *track* views without *capping* them, and expire
against the campaign instead.

---

## D. API contract

Follows existing conventions exactly: internal routes mount under `/api/v1/business`
behind `requireAuth` with `orgIdFor(req)`; client-facing routes mount under the existing
public `/api/v1/share/:token` namespace, alongside the messaging endpoints already there.

### D.1 Internal — authenticated team

| Method | Path | Min role | Purpose |
|---|---|---|---|
| GET | `/assets/:assetId/versions` | VIEWER | Version timeline |
| POST | `/assets/:assetId/versions` | MEMBER | Register V(n+1) after protect |
| GET | `/versions/:versionId/comments` | VIEWER | Threads for a version |
| POST | `/versions/:versionId/comments` | MEMBER | Comment or reply |
| PATCH | `/comments/:commentId` | MEMBER | Status transition |
| GET | `/campaigns/:campaignId/change-requests` | VIEWER | Actionable queue |
| POST | `/versions/:versionId/request-review` | MEMBER | DRAFT → IN_REVIEW |
| GET | `/campaigns/:campaignId/messages` | VIEWER | Campaign thread |
| POST | `/campaigns/:campaignId/messages` | MEMBER | Send |
| GET | `/campaigns/:campaignId/collaboration` | VIEWER | Overview counters + Needs Attention |

### D.2 Client-facing — token-scoped, no account

| Method | Path | Gate |
|---|---|---|
| GET | `/share/:token/review` | `reviewMode` |
| GET | `/share/:token/comments` | `allowComments` |
| POST | `/share/:token/comments` | `allowComments` |
| POST | `/share/:token/change-request` | `allowChangeRequest` |
| POST | `/share/:token/approve` | `allowApproval` **+ `otpVerified`** |
| GET | `/share/:token/versions` | `reviewMode` |
| GET | `/share/:token/events` | SSE — token-keyed channel |

Every client route resolves scope server-side through
`token → ShareLink → assetId → Asset.campaignId → Campaign.organizationId`,
and rejects any body-supplied `campaignId`, `assetId` or `organizationId`.
**Nothing about scope is ever taken from the request.**

---

## E. Permission matrix

| Action | Owner | Manager | Member | Viewer | Client | Ext. creator |
|---|---|---|---|---|---|---|
| View campaign | ✓ | ✓ | ✓ | ✓ | — | — |
| View shared asset | ✓ | ✓ | ✓ | ✓ | token | token |
| Comment | ✓ | ✓ | ✓ | — | if allowed | if allowed |
| Raise change request | ✓ | ✓ | ✓ | — | if allowed | — |
| Resolve change request | ✓ | ✓ | ✓ | — | own only | — |
| Upload new version | ✓ | ✓ | ✓ | — | — | — |
| Request review | ✓ | ✓ | ✓ | — | — | — |
| **Approve version** | ✓ | ✓ | — | — | **OTP** | — |
| Configure review link | ✓ | ✓ | — | — | — | — |
| Revoke link | ✓ | ✓ | — | — | — | — |
| Campaign message | ✓ | ✓ | ✓ | — | ✓ | if assigned |
| Download | ✓ | ✓ | ✓ | ✓ | `allowDownload` | `allowDownload` |

Enforced in the service layer via `requireOrgRole` for internal actors and via
link-permission columns for token actors — **never by hiding buttons**, per §26.
`INVESTIGATOR` sits between MANAGER and MEMBER in the existing hierarchy and inherits
MEMBER-level collaboration rights.

---

## F. UI/UX flow

```text
TEAM                                       CLIENT
────────────────────────────────────       ──────────────────────────────
Protect asset  ──►  V1 created
       │            reviewStatus DRAFT
       ▼
Share ▸ Review mode  ──────────────────►   Opens secure link
  ☑ comments  ☑ change requests               │
  ☑ approval                                  ▼
       │                                   Reads · comments · anchors
       ▼                                       │
IN_REVIEW                                      ▼
       │                                   [ Request changes ]
       │◄──────────────────────────────────────┘
       ▼
CHANGES_REQUESTED
Needs Attention: 1 open request
       │
       ▼
Protect new file ─►  V2   V1 → SUPERSEDED
       │                  (V1 DNA + vault untouched)
       ▼
IN_REVIEW  ────────────────────────────►   Reviews V2
                                               │
                                               ▼
                                           [ Approve ] ─► OTP
                                               │
       ┌───────────────────────────────────────┘
       ▼
APPROVED · immutable · audit-logged
```

Every transition emits one `platformEvents.emit()`, producing the notification, the
campaign activity row and the audit entry together — satisfying §22's prohibition on
duplicate activity systems without writing a second pipeline.

### F.1 Campaign Overview — Needs Attention

Derived, not stored. Each item is a query against the four new tables and deep-links
into the asset review at the right version:

- `n` assets waiting for client review — versions `IN_REVIEW` with an active review link
- `n` change requests need response — comments `kind=CHANGE_REQUEST, status=OPEN`
- `n` assets awaiting approval — `IN_REVIEW`, client has opened, no approval row
- Client has not opened V`n` — review link exists, no access log entry since upload

### F.2 Client review surface

An extension of `ShareViewerPage`, not a replacement. Desktop splits viewer left /
review panel right; mobile stacks viewer → status → comments → actions, per §29.
When `reviewMode` is false the panel does not render at all and the page behaves
exactly as it does today — which is what keeps every existing share link safe.

---

## G. Implementation plan

Reordered from specification §49 in one respect: **versioning moves ahead of comments.**
Every comment, request and approval is version-anchored, so building comments first
would mean building them twice.

| Phase | Scope | Notes |
|---|---|---|
| **P0** | **Email capability** | Pick a provider, wire a single `sendMail()` service, connect to existing OTP generation. **Blocker — needs your decision** |
| **P1** | **Version foundation** | `AssetVersion` + `ReviewStatus`. Backfill each existing campaign asset as V1 from its current DNA/vault/certificate. Versions tab goes live, read-only. Additive migration only |
| **P2** | Comments & change requests | `ReviewComment`, threads, statuses, internal-only UI first. Anchors for image and video; DOCX page anchors; PDF unanchored. Events emitted into existing pipeline |
| **P3** | Review lifecycle & approval | `VersionApproval`, guarded state transitions, new-version flow reusing the protect path at `vault.controller.ts:266`, OTP-gated approve. Wrapped in a Prisma transaction per §51 |
| **P4** | Client review surface | Extend `ShareViewerPage` behind `reviewMode`. Review-permission controls added to share configuration. Existing links keep today's behaviour by default |
| **P5** | Campaign messaging | `CampaignMessage`, migrating `ShareViewerMessage` forward rather than replacing it. System messages on version and approval events |
| **P6** | Realtime | Extend `realtimeHub` with a token-keyed channel so clients can subscribe. Reuses existing SSE transport — no new provider, per §19 |
| **P7** | Polish & regression | Empty states, skeletons, scoped error boundaries, mobile, and the full regression pass |

### G.1 Deliberately deferred

Presence and typing indicators (§20), version comparison (§46) and PDF anchoring.
Review is asynchronous — a client reads a long document over an hour — so typing
indicators solve a problem this workflow does not have, and they would be the first
thing to break on a free-tier instance that sleeps.

---

## H. Files to change

All additive.

| File | Change |
|---|---|
| `prisma/schema.prisma` | 4 models, 4 enums, 5 `ShareLink` columns, relations on `Asset`/`Campaign` |
| `src/api/routes/business.routes.ts` | Append collaboration routes |
| `src/api/controllers/business.controller.ts` | Handlers using existing `orgIdFor` |
| `src/api/routes/share.routes.ts` | Append token-scoped review routes |
| `src/services/share/share-link.service.ts` | Honour review-permission columns |
| `src/services/platform-events/realtime-hub.ts` | Add token-keyed channel alongside user channel |
| `client/src/pages/business/CampaignWorkspacePage.tsx` | Activate 4 placeholder tabs |
| `client/src/pages/ShareViewerPage.tsx` | Review panel behind `reviewMode` |
| `client/src/services/business.api.ts` | Client bindings |

---

## I. Files to reuse unchanged

| Asset | Used for |
|---|---|
| `requireOrgRole` | All internal authorisation |
| `platformEvents.emit()` | Notification + activity + audit in one call |
| `organizationAuditLog` | Campaign activity feed |
| `Notification` + `deepLink` | Team notifications |
| `ShareRecipient` · OTP | Client identity and approval evidence |
| `vault.controller.ts` protect path | New-version upload — **no second uploader** |
| `BusinessKit` | Every panel, tab, skeleton, empty state |
| `docx-preview` · `<img>` · `<video>` | Viewer and anchor targets |
| `react-hot-toast` | Transient feedback |
| DNA · Vault · Certificate pipeline | **Entirely untouched** |

---

## J. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| No email — clients unreachable | **Blocker** | P0. Nothing client-facing works properly without it |
| Approval on a forwarded link | **High** | OTP required for approve; bind recipient + device + IP to the approval row |
| View cap strangles review | **High** | Review links track views without capping; expire against campaign |
| Free-tier cold start (~50 s measured) breaks SSE | Medium | Treat realtime as an enhancement; never let correctness depend on it. Poll fallback |
| `realtimeHub` is in-process | Medium | Correct at one instance. Revisit if the backend ever scales beyond one |
| Two scoping regimes drift apart | Medium | Validate the asset↔campaign↔org chain on every write; never trust request scope |
| Migration on a database that was wiped once | Medium | All changes additive. Verify migration state before running; back up first |
| Viewer regression | Medium | 1,357-line file serving live links. Gate everything behind `reviewMode`, default false |
| Anchors orphan across versions | Low | Store the quote; mark orphaned; never attempt relocation |

---

## K. Test plan

Mapped to specification §52 A–P. Tenant isolation and immutability are the cases that
must never regress.

| # | Case | Passes when |
|---|---|---|
| C | **Tenant isolation** | Token for campaign X returns 404 for any asset, version, comment or message of campaign Y — with IDs supplied directly in the body |
| G | **Version immutability** | After V2 exists, V1's `dnaRecordId`, `vaultId`, `contentHash` and certificate are byte-identical; V1 file still decrypts and verifies |
| I | Approval identity | Approve without `otpVerified` → 403. With OTP → row carries recipient, device, IP |
| D/E | Comment round trip | Client comment appears for team without refresh; reply returns to client |
| F | Change request | Appears in Needs Attention and the campaign queue with `OPEN` |
| K/L | Expiry · revocation | Expired and revoked links refuse comment, change request and approve — not merely hide the buttons |
| M | Download control | `allowDownload=false` blocks the file route directly, not just the UI |
| N | Activity completeness | All 12 §22 event types land in campaign activity and audit log |
| O | Mobile | Review stacks correctly; no horizontal page overflow |
| P | **Regression** | Individual · Business · Exchange · Vault · DNA verify · existing share links · certificates all behave exactly as before |
| + | Legacy share links | A link created before this work renders identically, with no review UI |

---

## Decisions required before Phase 0

1. **Which email provider?** Resend is fastest to wire; SendGrid if deliverability
   reporting matters. This is the one true blocker.
2. **Can any client contact approve, or does each campaign need a named approver?**
   Determines whether `ShareRecipient` alone is sufficient.
3. **Is approval per-asset, or per-campaign deliverable?** Per-asset is modelled above.
   Campaign-level sign-off would add a fifth table.
4. **Do you accept OTP-gated approval?** §25 says not to add new identity requirements.
   OTP already exists in this product, and is proposed for the approve action only —
   but without it, approvals are link-bearer claims.
5. **PDF anchoring now, or later?** Requires replacing the iframe with `pdf.js`.
   Recommend later — image, video and DOCX cover the current campaign asset.

---

**Status: awaiting approval. No code has been changed.**
