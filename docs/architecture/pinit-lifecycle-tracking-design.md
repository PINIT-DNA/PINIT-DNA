# Pinit Lifecycle Tracking + Compact Video Frame DNA — Discovery & Design

Status: **APPROVED 2026-09-15** — decisions: (1) build/test on local Docker Postgres,
never the production `.env` database; (2) compact DNA for every frame, full 15-layer DNA
only on the video; (3) certificate download/share left out (client-only today).
Date: 2026-09-15 · Branch: `ashwitha` @ `aa0cacd`

Constraint carried through every section: the existing Asset / Vault / DNA /
Certificate / Share / Monitoring / Investigation flows are production-critical.
Everything below is additive.

---

## PHASE 1 — What already exists

### Identities (unchanged, never merged)

| Identity | Table | Notes |
|---|---|---|
| Asset ID | `assets.id` | Canonical. `vaultId`, `dnaId`, `certificateId` are plain pointer columns. |
| Vault ID | `vault_records.id` | Encrypted file. |
| DNA ID | `dna_records.id` | 15 layer tables hang off it. |
| Certificate ID | `certificates.certificateId` | Has `assetId`. Public verify by certificateId only. |
| Share link | `share_links.id` / `token` | Has `assetId`, `exchangeOrderId`, `sourceContext`. |
| Monitor | `monitor_records.id` | Has `assetId`. |
| Portfolio media | `portfolio_project_media` | References `vaultId` + `assetId` — never copies the file. |

### Event infrastructure — four stores already exist

| Store | Rows today | Keyed on | Written by | Read by |
|---|---|---|---|---|
| `platform_events` (Unified Event Engine) | 12,728 | `ownerUserId` + `entityType/entityId` | `platformEvents.emit()` → notification, timeline, audit subscribers | notifications, Exchange bridge |
| `asset_timeline_events` | 173 | `assetId` (FK, cascade) | `assetService.appendTimeline`, `recordAssetActivity` (PII scrubbed), Exchange `/exchange/activity` bridge | `AssetDetailPage` timeline, Asset 360 (`/creator/assets/:id/activity`) |
| `forensic_provenance_events` | 1,294 | `dnaRecordId` / `vaultId` / `shareLinkId` | timeline-subscriber (share + monitoring names), forensics | evidence / chain of custody |
| `audit_events` | 758 | `dnaRecordId` | audit-subscriber, `auditService.log` | intelligence audit |

**Conclusion:** no new event system is needed. `platform_events` is already the
unified, owner-scoped envelope; `asset_timeline_events` is already the asset
projection the UI reads.

### Where real actions already emit

| Action | Emitter today | Reaches asset timeline? |
|---|---|---|
| Asset protected | `appendTimeline CREATED/PROTECTED/CERTIFICATE/MONITORING_STARTED` | yes |
| Vault stored / DNA generated | `vault.stored`, `dna.generated` | no (vault/dna keyed) |
| Vault deleted | `vault.deleted` + `STATUS_CHANGE` | partly |
| Vault renamed | none (`PATCH /vault/:id/rename`) | no |
| Owner preview / retrieve / protected download | `vault.protected_download.ready` only | no |
| Certificate issued / verified / revoked / expired | `certificate.*` | no |
| Share created / viewed / downloaded / revoked / expired / forwarded | `share.link.*` | viewed + downloaded only |
| Monitoring match | `monitoring.match.found` + `DISCOVERY/TAMPERING` | yes (asset path) |
| Publish Guardian discovery / AI tampering | `publish_guardian.discovery`, `forensics.ai.tampering` | partly |
| Investigation started / completed | `investigation.*` | no |
| Evidence record created | none (monitoring + match pipeline `evidenceRecord.create`) | no |
| Evidence/client report issued, PDF downloaded | none | no |
| Exchange listed / updated / price / sold / paid / license / delivered / refund / dispute / cart / wishlist / review / viewed | bridge → `asset_timeline_events` | yes |
| Exchange **UNLISTED** | bridge sends it, **enum has no `UNLISTED` → silently skipped today** | **no (existing gap)** |
| Portfolio public view | `GET /portfolio/public/:slug` serves a snapshot, no event | no |
| Certificate download / share | **client-only** (`certificate-download.tsx`) — backend never sees it | — |

### Video frame protection — measured baseline

Source: `video-page-protection.service.ts` (every frame, concurrency 3).
Per frame it runs the full image pipeline: `DnaOrchestrator.generate` (15 layers +
HKCA 8×8 pixel package) and `localDnaIndexService.buildIndex` (multi-scale patches,
ORB descriptors, Python FAISS tiles).

Measured on the 84.87 MB video (2520×1080, 30 fps, 4,919 frames) and DB aggregates:

| Per complete frame | Rows | Bytes (row data) |
|---|---|---|
| `dna_records` + 15 layer tables + 1 provenance | 17 | ~28 KB |
| `local_feature_indexes` (ORB descriptors JSON, 1,500 keypoints) | 1 | ~100 KB |
| `local_dna_patches` (scales 16/32/64/128/256/512) | **2,465** | ~500 KB (203 B/row) + index overhead ≈ 1.2× |
| `spatial_auth_packages` (HKCA 8×8, 1080p frame) | 1 | **~650 KB** (keyed tags — incompressible) |
| **Total** | **~2,484** | **~1.3 MB data, ~1.9 MB with indexes** |

Processing: DNA ≈ 7.5–10 s/frame; DNA + patch index ≈ 229 s per batch of 3 frames
(~76 s/frame per worker). Decode alone: 150 frames in 7.5 s (~50 ms/frame).

Projected for the 4,919-frame video: **≈ 12.2 M rows, ≈ 9 GB, ≈ 104 hours.**
`local_dna_patches` is already 199,074 rows / 90 MB from 121 frames + images.

Why so many rows: a patch is ~27 bytes of real information
(pHash 8 + dHash 4 + aHash 4 + edge 1 + freq 1 + texture 1 + color 3 + x/y/scale 5)
stored as a 203-byte row with four B-tree indexes. Retrieval never uses the
`pHash16` index — `fragment-splice-detector` and `vault-local-dna-search` load all
patches of a candidate and bucket by 4-hex prefix **in memory**.

Decoder determinism (verified): same ffmpeg binary → identical RGB SHA-256 across
repeat decodes, `-threads 1` vs default, and seek-to-frame vs sequential.

### Environment constraint (important)

Local `.env` `DATABASE_URL` is the **production Supabase** database. Production schema
changes ship as idempotent `scripts/ensure-*.cjs` run in `start:prod` on Render.
Docker is installed but not running; `docker-compose.dev.yml` defines a local
Postgres 16 on port 5435.

---

## PHASE 2 — Proposed design (smallest additive change)

### A. Lifecycle layer — extend, don't duplicate

1. **Store:** reuse `platform_events`. Additive DDL: nullable `assetId` column + index
   `(assetId, createdAt)`. No new event table.
2. **Recorder:** new thin module `src/services/lifecycle/lifecycle-events.ts`
   - `recordLifecycle({ type, ownerUserId, actorUserId?, assetId? | vaultId? | dnaRecordId? | certificateId?, resource, context, metadata })`
   - resolves `assetId` from vault/dna/certificate when not given (owner-scoped query);
   - calls the **existing** emitter when one exists (no double emit), otherwise `platformEvents.emit`;
   - when an asset is resolved, projects into `asset_timeline_events` via existing
     `recordAssetActivity` (inherits Asset.id validation + PII scrub);
   - metadata passes through existing `scrubPayload`; country/device only where the
     module already has them; never tokens, IPs, emails, secrets.
3. **Asset timeline enum:** additive values only — `SHARE_REVOKED`, `SHARE_EXPIRED`,
   `UNLISTED` (fixes the silently-dropped Exchange event), `RENAMED`, `DELETED`,
   `ACCESSED`, `CERTIFICATE_VERIFIED`, `CERTIFICATE_REVOKED`, `EVIDENCE`,
   `INVESTIGATION` (already exists) reused.
4. **Read API:** `GET /api/v1/lifecycle/assets/:assetId` and `GET /api/v1/lifecycle/me`,
   `requireAuth`, owner check in the query (same 404 for not-owned vs missing).

### B. Event support matrix (only real backend actions)

| Requested type | Plan | Hook point |
|---|---|---|
| ASSET_PROTECTED | project existing | asset.service protect |
| ASSET_VIEWED | add | `GET /vault/:id/preview` (owner) |
| ASSET_ACCESSED | add | `POST /vault/:id/retrieve` |
| ASSET_DOWNLOADED | add | `POST /vault/:id/protected-download` |
| ASSET_SHARED | project existing `share.link.created` | share-link.service |
| ASSET_RENAMED | add | vault.service.rename |
| ASSET_DELETED | project existing `vault.deleted` | vault.service.delete |
| ASSET_RESTORED | **not added** — no restore flow exists | — |
| CERTIFICATE_ISSUED / VERIFIED / REVOKED | project existing | certificate.service |
| CERTIFICATE_VIEWED | **not added** — public view *is* verify | — |
| CERTIFICATE_DOWNLOADED / SHARED | **not added** unless approved: client-only today (see Decision 3) | — |
| PORTFOLIO_VIEWED | add, de-duplicated per portfolio/day, no viewer identity | `GET /portfolio/public/:slug` |
| PORTFOLIO_SHARED / ITEM_VIEWED / ITEM_ACCESSED | **not added** — no backend request per item or share | — |
| ASSET_LISTED / UNLISTED / PURCHASED / LICENSE_CREATED | already via bridge; add `UNLISTED` enum | Exchange bridge |
| PURCHASE_ACCESSED / DOWNLOADED | **not added in Hub** — happens in Exchange `/orders/download/authorize`, which does not post it; needs an Exchange (`main`) change | — |
| SHARE_LINK_CREATED / OPENED / DOWNLOADED / REVOKED / EXPIRED | exist as platform events; add asset projection for created/revoked/expired | share-link.service, vault-scheduler |
| EVIDENCE_GENERATED | add | monitoring + match-pipeline `evidenceRecord.create`, `POST /evidence/report` |
| EVIDENCE_VIEWED | add | `GET /evidence/records/:id` |
| EVIDENCE_DOWNLOADED | add | `GET /business/reports/:id/pdf`, `GET /share/client-report/:token/pdf` |
| EVIDENCE_SHARED | add | `POST /business/investigations/:id/reports` (issues tokenized report) |
| MONITORING_MATCH_FOUND | project existing | crawler services |
| SUSPICIOUS_USE_DETECTED | project existing | `publish_guardian.discovery` (tampered/high risk), `forensics.ai.tampering` |
| INVESTIGATION_STARTED / COMPLETED | project existing (asset-linked when vault/dna resolves) | unified-investigation.orchestrator |

Sharing security, expiry, device/location binding and access rules are not touched —
only emit calls are added after the existing successful action.

### C. Video frame DNA — compact storage (frame DNA ≠ lifecycle events)

Lifecycle events stay per action (one download = one event). Frame data lives in a
separate forensic table.

**New table `video_frame_dna` — one row per frame:**

| Column | Content | Size |
|---|---|---|
| `videoDnaRecordId`, `ownerUserId`, `frameIndex`, `timestampMs` | identity | — |
| `rgbSha256` | SHA-256 of decoded RGB24 (pinned decoder) | 32 B |
| `pHash64`, `dHash64` | whole-frame perceptual | 16 B |
| `hkcaRoot`, `hkcaRootMac` | 8×8 keyed pixel-cell Merkle root + MAC | 64 B |
| `patchPack` | all multi-scale patch fingerprints, binary-packed (27 B/patch, versioned header) | ~66 KB |
| `orbPack` | ORB descriptors binary (1,500 × 32 B) — keyframes only | ~48 KB |
| `decoder` | ffmpeg version + pix_fmt policy | — |

Video-level: `frameMerkleRoot` over all frame leaves stored with the video DNA, so one
root commits to every frame's identity.

HKCA tags are **not stored per frame**: the root commits to them; at investigation
time the frame is re-decoded from the vault original with the recorded decoder,
tags recomputed with the server key, and checked against the stored root (verified
deterministic). Tamper localization then works exactly as for images.

Estimated for the 4,919-frame video (to be measured in Phase 4):

| | Current | Proposed |
|---|---|---|
| Rows | ~12.2 M | ~4,920 |
| Storage | ~9 GB | ~0.35 GB |
| Processing | ~104 h | target < 2 h (one decode pass, patches from one raw buffer instead of 2,465 `sharp` extracts) |

Investigation readers (`video-investigation-composition`, `partial-video-recovery`,
`fragment-splice-detector` with `restrictToVaultIds`) get a pack reader that yields
the same `VaultPatchRow` shape, so matching logic is unchanged. Existing frame rows
(131 frames) keep working through the old path.

### D. Security

- Every lifecycle row has `ownerUserId`; every read filters on the JWT user.
- Public actions (portfolio view, certificate verify) record against the owner but
  never expose DNA/Vault IDs, UUIDs, storage URLs or signing material in responses.
- `scrubPayload` on all metadata; no tokens, IPs, emails or secrets.
- Tests: owner isolation (user B cannot read A's lifecycle or frame DNA).

### E. UI

- `AssetDetailPage` timeline renders the new types with plain labels, grouped as
  Protect → Store → Share → Track → Monitor → Understand → Prove.
- Frame DNA is shown only in the existing forensic/technical views as a summary
  (frames protected, frame Merkle root), never as per-frame rows in the main timeline.

### F. Database changes

- `prisma/schema.prisma`: `PlatformEvent.assetId?`, `AssetTimelineType` additive values,
  new `VideoFrameDna` model.
- `scripts/ensure-lifecycle-tracking.cjs`: idempotent `ADD COLUMN IF NOT EXISTS`,
  `ALTER TYPE … ADD VALUE IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, added to
  `start:prod`. **Not run against the local `.env` database** (production).

### G. Limitations (by design, not faked)

- External use is known only when Monitoring / Publish Guardian / Intelligence finds it.
- Certificate download/share, portfolio share and per-item views have no backend
  action today.
- Exchange purchase downloads need an Exchange-side emit.
- No restore flow exists for deleted assets.

---

## Decisions needed before Phase 3

1. **Database for implementation and tests** — local Postgres via Docker
   (recommended) vs mocked tests only. Production Supabase is excluded.
2. **Per-frame content** — compact frame DNA for every frame, full 15-layer DNA only
   for the video (recommended) vs keeping 15-layer DNA per frame.
3. **Client-only actions** — add a small authenticated endpoint the certificate
   download/share buttons call, so those real clicks become events — or leave them out.

---

## PHASE 3-5 — What was actually built (2026-09-16)

### Lifecycle layer

| Piece | File |
|---|---|
| Vocabulary, stages, labels, event maps | `src/services/lifecycle/lifecycle-types.ts` |
| Owner-scoped Asset.id resolution | `src/services/lifecycle/asset-resolver.ts` |
| Emitters for actions that had no event | `src/services/lifecycle/lifecycle-events.ts` |
| Read side (merges lifecycle rows + asset timeline) | `src/services/lifecycle/lifecycle-query.service.ts` |
| API | `src/api/controllers/lifecycle.controller.ts`, `src/api/routes/lifecycle.routes.ts` |
| Stamping at persist time | `src/services/platform-events/platform-event.engine.ts` |

The engine stamps `lifecycleType` and the owning `assetId` onto events every module
ALREADY emits, so share links, certificates, monitoring, investigations and vault
store/delete joined the lifecycle with no change at their call sites. New emits were
added only where a real backend action existed with no event: vault preview
(ASSET_VIEWED, de-duplicated per file per day because thumbnails re-request it),
retrieve and protected download (ASSET_DOWNLOADED), rename, certificate verified,
portfolio public view, and the four evidence actions.

Not emitted, and declared as such in code: `ASSET_ACCESSED` (no distinct server
action) and `PURCHASE_DOWNLOADED` (happens inside Exchange, which does not post it).

Deliberately NOT done: writing these into `asset_timeline_events`. Exchange already
writes `VIEWED`/`DOWNLOADED` there and Asset 360 counts them as marketplace views and
buyer downloads; adding owner activity would have corrupted those numbers. The read
API merges both stores instead and drops an action recorded twice within 120 s. The
one timeline change is the additive `UNLISTED` enum value, which Exchange was already
sending and the enum was silently rejecting.

### Compact video frame DNA

`src/services/videos/frame-dna/`: `raw-frame-decoder.ts` (streamed rgb24 frames,
`-noautorotate`), `fast-patch-fingerprint.ts` (all seven descriptors from raw pixels),
`raw-patch-grid.ts` (same grid/scales/caps as the image path), `patch-pack.ts` (PFP1,
30 B/patch), `video-frame-dna.service.ts` (per-frame row + frame Merkle root),
`frame-dna-verify.service.ts` (re-derive HKCA tags from the vault original),
`frame-dna.repository.ts` (reader adapter for the investigation code).

Readers updated to read BOTH generations: `fragment-splice-detector`,
`partial-video-recovery`, `video-investigation-composition`.

### Measured, 2520x1080 (the resolution of the 84.86 MB video), every frame

| | Legacy | Compact | Change |
|---|---|---|---|
| Time per frame | 77,033 ms (patch grid alone; ~76 s/frame seen in production) | 2,575 ms | 30x faster |
| Rows per frame | ~2,484 | 1 | 2,484x fewer |
| Storage per frame | ~1.05 MB patch rows + ~0.65 MB HKCA tags | 23 KB | ~75x smaller |
| Patch fingerprints kept | 2,465 | 2,465 | unchanged |
| Peak memory | all JPEG frames held at once (8.15 MB for 60; ~1.5 GB for 4,919) | one frame | bounded |

Projected for that 4,919-frame video: ~12.2 M rows and ~8.5 GB becomes ~4,919 rows
and ~113 MB; ~104 hours becomes ~3.5 hours (measured while the test suite was
competing for CPU, so pessimistic).

Forensic equivalence, measured on a real decoded frame: 83% of patches hash
identically to the JPEG path and 95% still match as patches — a fragment hit needs 6.
Video investigation avoids the drift entirely by fingerprinting the probe the same
way when the candidates are compact frames.

### Why HKCA tags are not stored

Tags are keyed HMACs (~650 KB per 1080p frame, incompressible). The root and its MAC
are stored; tags are re-derived from the vault original when an investigation needs
them. That is sound only because decoding is deterministic, which was verified before
relying on it: identical RGB SHA-256 across repeat decodes, `-threads 1` vs default,
and seeking versus sequential reads. The decoder identity is recorded with the video.

### Tests

`tests/services/video-frame-patch-pack.test.ts`, `video-frame-dna-identity.test.ts`,
`video-frame-fast-fingerprint.test.ts`, `lifecycle-mapping.test.ts`,
`tests/security/lifecycle-authorization.test.ts`.

Database-backed frame tests were deliberately NOT added to the jest suite: the repo's
`.env` points at the production Supabase database, so such a test would write to
production on any developer's machine. Database validation ran against the local
docker Postgres through a temporary script, which was deleted after measuring.

### Test results (2026-09-16)

Backend `tsc --noEmit`: clean. Client `tsc --noEmit`: clean. Client production build:
passes (1m 24s).

Full suite: **112 suites passed, 1,055 tests passed**, 6 failed, 23 skipped.
The 6 failures are the pre-existing baseline measured before this work began —
`candidate-ranking-engine` (3), `enterprise-investigation-pipeline`,
`evidence-pairing`, `unified-investigation`, and `health` (missing `supertest`).
Same suites, same names, same count as the baseline: no new regressions.
Passing tests went from 981 to 1,055 (+74 from the six new suites).

One real bug was found and fixed by the suite rather than by inspection: the first
version of the missing-column fallback retried with `prisma.platformEvent.create()`,
which fails identically because the generated client returns every column of the
model after an insert. The event was being lost. The retry is now raw SQL naming only
the original columns, pinned by
`tests/services/platform-event-lifecycle-stamp.test.ts`.

### Live checks

- `scripts/ensure-lifecycle-tracking.cjs` run twice against the local database:
  identical output, no errors — and it is now in the `start:prod` boot chain.
- The objects it creates match `prisma db push` exactly (column names, types,
  nullability and index names compared directly).
- Backend restarted on the new code: `/api/v1/ping` 200, and
  `/api/v1/lifecycle/me` answers 401 without a token.
