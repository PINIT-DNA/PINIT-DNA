# PINIT-DNA Phase 9 — Migration & Implementation Blueprint

**Document type:** Implementation planning only  
**Audience:** Senior engineering  
**Status:** Blueprint — **no code, no schema migration, no push, no deploy**  
**Date:** 2026-07-16  

**Inputs:** Phases 1–8 audits + enterprise target architecture (Identity / Ownership / Evidence / Acceptance engines; 15 DNA Modules).

**Governing principles**

1. Existing production system must keep running.  
2. Prefer improve / refactor / stabilize / reuse over greenfield rewrite.  
3. Do not remove working business logic unless it blocks determinism, immutability, or ownership correctness.  
4. Dual-run and feature flags before cutover.  
5. Investigation must never go dark.

**Locked conceptual target**

```text
DNA Engine
├── Identity Engine   (Modules L1–L10)   → “Is this the same content?”
├── Ownership Engine  (Modules L12,L14,L15) → “Who owns it?”
├── Evidence Engine   (Modules L11,L13)  → “Legal / risk evidence?”
└── Acceptance Engine                   → Verdict
```

Investigation: **Identity → Ownership → Evidence → Acceptance → Verdict**

---

# PART 1 — CURRENT ARCHITECTURE MAP

## 1.1 End-to-end dependency graph

```text
Upload (multer)
    ↓
DNA Generation
  UniversalFileRouter → DnaOrchestrator | *DnaEngine
  Layers L1–L15 / universalFingerprints
    ↓
DNA Storage (Prisma dna_records + *_layers)
    ↓
Vault (optional POST /vault/store — AES-GCM + vault_records)
    ↓
Certificate (certificate issue / verify)
    ↓
Indexes (LocalFeatureIndex, FAISS/CLIP via python-ai, optional)
    ↓
Investigation Upload
    ↓
Retrieval (vector + patch + watermark/token/SHA)
    ↓
Candidate Selection / Ranking
    ↓
Comparison (live vault FP + registry cross-check today)
    ↓
Acceptance (scorecard + decide)
    ↓
Investigation Report (SSE + UnifiedInvestigationPage)
    ↓
Monitoring / Crawler (optional, often skipped on investigate)
    ↓
Evidence / Provenance / Reports
    ↓
Notifications / Platform Events
```

## 1.2 Module → files / routes / tables / dependencies

| Pipeline stage | Primary files / services | Controllers / routes | Tables | Depends on |
|----------------|--------------------------|----------------------|--------|------------|
| **Upload** | Multer middleware in route handlers | `dna.routes`, `vault.routes`, `unified-investigation.routes` | temp disk / upload dir | Auth JWT |
| **DNA Generation** | `universal-file-router.ts`, `dna.orchestrator.ts`, `layers/layer1…10.ts`, `layers-11-15.service.ts`, `engines/*/*-dna-engine.ts` | `dna.controller.generateDna` → `POST /dna/generate` | `dna_records`, `*_layers`, `universalFingerprints` JSON | File type detector, sharp, config |
| **DNA Storage** | Orchestrator persist tx, `dna-storage-audit.service.ts` | `GET /dna/:id`, `GET /dna/storage-audit` | Layer tables above | Prisma |
| **Vault** | `vault.service.ts`, `encryption.service.ts` | `POST /vault/store`, retrieve, protected-download | `vault_records` | DNA record, Supabase storage |
| **Certificate** | Certificate services under `services/` + mgmt controller | `certificate-mgmt.routes` | `certificates` | DNA + owner |
| **Local / patch index** | `local-dna-index.service.ts`, `local-dna-patch-generator.service.ts`, `vault-local-dna-search.service.ts` | `POST /vault/local-dna/backfill` | `local_feature_indexes`, `local_dna_patches` | Vault bytes, DNA |
| **AI / CLIP** | `ai-embeddings.service.ts`, `python-ai/` | `ai.routes` | FAISS files / metadata (not Prisma) | python-ai |
| **Retrieval** | `vault-similarity-vector.service.ts`, `enterprise-retrieval-engine.service.ts`, `pinit-original-identity-recovery.service.ts` | Investigation routes | Reads DNA + vault + indexes | Performance config |
| **Candidate selection** | `candidate-ranking-engine.service.ts`, `vault-candidate-ranking.service.ts`, `authoritative-asset.service.ts` | (internal) | — | Vectors, patch, identity hits |
| **Comparison** | `dna-comparison.service.ts`, `ephemeral-fingerprinter.ts`, `stored-dna-fingerprinter.service.ts`, `comparison-engine.ts`, `deep-vault-compare.service.ts` | `POST /dna/compare`, auto-compare, investigation deep | Temp DNA rows (ephemeral) | Policy `INVESTIGATION_PREFER_LIVE_VAULT_FP` |
| **Acceptance** | `acceptance-engine.service.ts`, `acceptance-evidence.builder.ts` | (internal) | — | Evidence channels |
| **Investigation** | `unified-investigation.orchestrator.ts`, `enterprise-recovery-pipeline.service.ts` | `POST …/unified-investigate` | Provenance optional | All above |
| **Monitoring** | `monitoring.service.ts`, crawler engine | `monitoring.routes` | `monitor_records`, crawl tables | DNA enroll |
| **Evidence / provenance** | `forensic-provenance.service.ts`, `evidence/*.ts` | `evidence.routes` | `forensic_provenance_events`, `evidence_records`, `incidents` | DNA / vault / share |
| **Reports** | Evidence report + client forensic storage | `ReportsPage`, intelligence report | Client local + API | Investigation output |
| **Notifications** | notification services + platform-events | `notification.routes` | `notifications`, `platform_events` | Events |
| **Share / Access** | `share-link.service.ts`, risk engine | `share.routes` | `share_links`, access logs | Vault / DNA |
| **TEP / watermark runtime** | `tep.service.ts`, watermark status / leak verify | `tep.routes`, vault tracking | TEP / watermark profiles | Protect download |
| **Auth / profile / admin** | auth, profile, admin, super-admin | respective routes | `users`, sessions, audit | — |

### Frontend surface (investigation-critical)

| Page | Role |
|------|------|
| `GeneratePage.tsx` | DNA generate UX |
| `DNARecordsPage.tsx` | List DNA |
| `VaultPage.tsx` | Vault store/list |
| `CertificatesPage.tsx` / `VerifyCertificatePage.tsx` | Certs |
| `UnifiedInvestigationPage.tsx` | Main investigation |
| `AccessIntelligencePage.tsx` / `LinkIntelligencePage.tsx` | Access / link intel |
| `MonitoringPage.tsx` | Monitors |
| `ReportsPage.tsx` | Reports |
| `ComparePage.tsx` / `ForensicDiffPage.tsx` | Compare |
| `DashboardPage.tsx`, Admin pages | Ops |

---

# PART 2 — MODULE INVENTORY

Classification key: **KEEP** | **MINOR** | **MAJOR** | **REPLACE** | **REMOVE**

| Module | Class | Why |
|--------|-------|-----|
| Auth / JWT / multi-tenant `ownerUserId` scoping | **KEEP** | Production-critical; orthogonal to DNA redesign |
| Share links, access logs, OTP, risk engine | **KEEP** | Business product; consume DNA ids only |
| Vault encrypt/decrypt AES-GCM + Supabase | **KEEP** | Working; vault remains file store, not DNA identity |
| Certificate issue/verify/revoke | **KEEP** (+ **MINOR** bind to `content_id`) | Ownership factor; keep API |
| TEP / protected download / tracking | **KEEP** (+ **MINOR** align payload to Ownership Engine) | Working identity shortcuts |
| Monitoring / crawler | **KEEP** | Downstream of DNA id; avoid early churn |
| Notifications / platform events | **KEEP** | Event bus |
| Forensic provenance events table | **KEEP** (+ **MAJOR** absorb session origin/behavior) | Already append-only design |
| `ComparisonEngine` L1–L4 math | **KEEP** core (+ **MINOR** suite versioning) | Sound graded/binary compare |
| `PerceptualLayer` / structural / semantic generators | **KEEP** algorithms (+ **MINOR** pin versions) | Deterministic content cores |
| `CryptographicLayer` | **MINOR** | Prefer dual bitstream + normalized policy; compare policy clarity |
| `MetadataLayer` | **MAJOR** | Remove dnaRecordId from identity hash; persist compare-stable digest |
| `SteganographyLayer` / L6 | **MAJOR** | Split random trace embed vs deterministic content seal |
| `BehavioralLayer` / `OriginLayer` as DNA identity | **REPLACE→Provenance** | Not content identity; relocate |
| `RelationshipLayer` DB-time duplicates | **MAJOR** | Replace with deterministic family id; graph edges external |
| `EvolutionLayer` timestamped leaves | **MAJOR** | Content/parent-only merkle |
| L11 deepfake heuristics | **MINOR→MAJOR** later | Keep slot; upgrade model under Evidence Engine |
| L12 dct watermark hash | **MAJOR** | Real extractable mark under Ownership Engine |
| L13 custody JSON in DNA | **MAJOR** | Custody head pointer + ledger events |
| L14 random ZK | **MAJOR** | Deterministic commitment under Ownership |
| L15 biometric on DNA row | **MINOR** | Opaque bind id; privacy |
| `universalFingerprints` mutable JSON | **MAJOR** | Stop post-seal mutation; seal or migrate to layer rows |
| Self-learning / transform history writing DNA JSON | **REMOVE** from DNA path | Move to events / derived packages |
| `EphemeralFingerprinter` for **probe** | **KEEP** | Probe has no stored DNA |
| `EphemeralFingerprinter` for **vault** identity | **REPLACE** with stored read | SSoT |
| `INVESTIGATION_PREFER_LIVE_VAULT_FP=true` | **REPLACE** default false after dual-run | Core investigation bug class |
| `StoredDnaFingerprinter` | **KEEP** (+ **MINOR** expand modules) | Target path |
| `DeepVaultCompareService` dual live+registry | **MAJOR** | Primary = stored; live = optional audit |
| `VaultSimilarityVectorService` | **KEEP** (+ **MAJOR** indexes later) | Reuse scoring; stop O(N) at scale |
| Local DNA patch index + search | **KEEP** (+ elevate as Identity L7) | Best crop path today |
| `CandidateRankingEngine` | **KEEP** (+ **MINOR** recall-first union) | Threshold policy reuse |
| `AcceptanceEngine` + evidence builder | **MAJOR** structure / **KEEP** verdict set | Split Identity vs Ownership channels; keep 5 verdicts |
| `UnifiedInvestigationOrchestrator` | **MAJOR** wiring | Engine order; keep SSE/report shapes where possible |
| UI investigation pages | **MINOR** labels/channels | Avoid big UX rewrite early |
| python-ai ORB/CLIP/FAISS | **KEEP** (+ version pins) | Ownership/Identity retrieval aids |
| Demo scenarios 1–5 harness/docs | **KEEP** | Regression gate every phase |

---

# PART 3 — IMPLEMENTATION ORDER (safest)

Order minimizes regression: **contracts & flags → identity determinism → stop live vault regen → ownership/evidence separation → acceptance → storage seal → scale indexes → cleanup**.

| Step | Name | Why first | Depends on | Test after | Must never break |
|------|------|-----------|------------|------------|------------------|
| **0** | Feature flags + suite version constants | Safe dual-run | — | Flag off = today’s behavior | All APIs |
| **1** | Document Identity vs Ownership vs Evidence contracts in code comments/types only | Aligns team | 0 | Typecheck | Runtime |
| **2** | Persist compare-stable L5 + deterministic L6 seal **alongside** existing fields | Dual-write | 0–1 | Generate + compare same file twice | Existing verify using old fields |
| **3** | Investigation: prefer **stored** DNA when flag on; live as audit | SSoT | 2 | Scenarios 1–5, crops, exact | SSE + reports |
| **4** | Stop mutating `universalFingerprints` for self-learning (write events instead) | Immutability | 0 | Non-image generate | Vault/share |
| **5** | Acceptance: ownership only from Ownership channels; identity from DNA/visual/patch | FP ownership | 3 | Verified/Possible/NotFound cases | Cert/WM instant paths carefully |
| **6** | Relocate behavioral/origin writes to provenance events (still fill old tables optionally) | Clean identity | 4–5 | Generate still succeeds | Timeline UI |
| **7** | Package header fields (versions, integrity hash) as **additive columns** | Versioning | 2 | Storage audit | Old readers |
| **8** | Retrieval recall union (patch+hash+vector) before hard top-25 truncate | Recall | 3 | Crop lookalike tests | Latency budgets |
| **9** | Indexes (hash, pHash LSH, patch) — additive | 100M path | 8 | Perf tests | Correctness |
| **10** | Ownership L12 extractable mark / L14 commit — dual with old | Ownership quality | 5 | Protect download + investigate | Old TEP |
| **11** | Remove/disable live-primary path; deprecate mutable JSON writers | Cleanup | 3–7 stable | Full regression | Prod flags |
| **12** | UI channel labeling (Identity / Ownership / Evidence) | Clarity | 5 | UX smoke | Layout |

**Never break across all steps:** auth, vault retrieve, share viewer public path, certificate verify public, multi-tenant isolation, scenario demos.

---

# PART 4 — DATABASE MIGRATION PLAN

**No migrations in this phase — planning only.**

## 4.1 Reuse as-is (safe)

| Table | Role in target |
|-------|----------------|
| `dna_records` | Package hub |
| `crypto_layers` … `semantic_layers`, `metadata_layers`, `stego_layers` | Identity L1–L6 storage |
| `local_feature_indexes` / `local_dna_patches` | Identity L7 |
| `vault_records` | File ciphertext |
| `certificates` | Ownership factor |
| `forensic_provenance_events` | Evidence + old L7/L9 duties |
| `verification_logs`, `audit_events` | Audit |
| Share / monitor / notification tables | Unchanged product |

## 4.2 Additive columns (preferred — **safe / optional until writers fill them**)

On `dna_records` (conceptual):

- `dna_version`, `algorithm_version`, `fingerprint_version`, `generator_version` (extend beyond `schemaVersion` / `engineVersion`)
- `content_id` (canonical SHA)
- `integrity_merkle_root`, `integrity_hash`
- `storage_status`, `validation_status`
- `sealed_at`
- `supersedes_dna_id` (nullable)

On layer tables (conceptual):

- `algorithm_id`, `fingerprint_version`, `layer_digest`
- L5: `claims_digest` (compare-stable)
- L6: `content_seal_hmac` (deterministic)

**Migration class:** Additive → **Safe** if nullable + dual-write; readers ignore unknowns.

## 4.3 Deprecated (do not drop early — **breaking if dropped**)

| Column / pattern | Deprecate when |
|------------------|----------------|
| L5 `metadataHash` including `dnaRecordId` | After `claims_digest` backfilled |
| L6 `payloadHmac` as compare identity | After `content_seal_hmac` |
| Mutating `universalFingerprints.selfLearning` | Immediately stop writes; keep column |
| Behavioral/origin as identity | After provenance dual-write |

**Drop columns:** only in a late cleanup milestone — **Breaking** — requires versioned API + backfill.

## 4.4 Indexes (additive — **safe**)

| Index | Purpose |
|-------|---------|
| `(owner_user_id, content_id)` or `(owner_user_id, sha256_hash)` unique-ish | Exact retrieval |
| `perceptual_layers(p_hash64)` or LSH side tables | Visual recall |
| Existing `local_dna_patches(pHash16)` | Keep / extend |
| `(tenant, family_id)` later | L8 |

## 4.5 Immutability support

- App-level: refuse `UPDATE` on sealed DNA (flag).  
- Optional DB: trigger or RLS later — **not required for first milestones**.  
- Cascade delete remains a product risk; document “seal ≠ legal hold.”

## 4.6 Summary

| Change | Class |
|--------|-------|
| Additive version/integrity columns | Safe / optional |
| Dual-write new digests | Safe |
| Stop JSON mutation | Safe behavior change |
| Drop old columns | Breaking (late) |
| New tables for LSH posting | Optional scale phase |

---

# PART 5 — API MIGRATION

| API | Action | Compatibility | Frontend | Third-party |
|-----|--------|---------------|----------|-------------|
| `POST /dna/generate` | **Modify** internals; **Keep** response shape; add optional version fields | Backward compatible if new fields additive | Generate page minor | Low |
| `GET /dna/:id` | **Modify** additive fields | Compatible | DNA records minor | Low |
| `POST /dna/:id/verify` | **Modify** prefer stored + new seals | Compatible | Verify flows | Low |
| `POST /dna/compare` | **Modify** version headers in result | Compatible | Compare page | Low |
| `POST /dna/auto-compare` | **Keep/Modify** same | Compatible | — | — |
| Lightweight / extract fingerprint APIs | **Keep** | Compatible | — | Internal tools |
| `GET /dna/storage-audit` | **Modify** check new integrity fields | Compatible | Admin | — |
| `POST /vault/store` | **Keep** | Compatible | Vault | — |
| Vault retrieve / protected-download | **Keep** (+ ownership payload align later) | Compatible | Vault | Critical |
| Certificate CRUD / public verify | **Keep** | Compatible | Certs | Public verify |
| `POST /…/unified-investigate` | **Modify** pipeline; **Keep** SSE event names where possible | Compatible with tolerant UI | Investigation **careful** | Super-admin investigate |
| Monitoring / share / notifications / ai | **Keep** | Compatible | Respective pages | — |
| Future `GET /dna/:id/package` | **Version** new | Opt-in | Later | — |

**Rule:** No breaking removal of fields in v1 responses for at least one release after dual-write.

---

# PART 6 — DNA GENERATION MIGRATION

| | |
|--|--|
| **Current** | Router → orchestrator/engines → L1–15 with random/time modules → persist; JSON mutable later |
| **Target** | Canonicalize → Identity modules L1–L10 deterministic → Ownership L12/14/15 → Evidence L11/13 → merkle seal → INSERT only; idempotent on `(tenant, content_id, suite)` |
| **Files** | `universal-file-router.ts`, `dna.orchestrator.ts`, `layers/*`, `engines/**`, `layers-11-15.service.ts`, dna enhancements / self-learning writers |
| **Risk** | **High** if cut over abruptly; **Medium** with dual-write |
| **Strategy** | (1) Dual-write new digests (2) Idempotency key optional (3) Stop self-learning DNA writes (4) Feature-flag sealed mode for new records |
| **Rollback** | Flag off; old columns remain authoritative |

---

# PART 7 — DNA STORAGE MIGRATION

| Topic | Plan |
|-------|------|
| Immutable storage | Application seal + stop UPDATEs on identity fields; provenance for mutations |
| Version storage | Additive columns on `dna_records` + per-module `algorithm_id` |
| Integrity hash | Compute merkle over layer digests at seal; store root |
| Layer storage | Keep Prisma 1:1 tables for images; freeze JSON for non-image or gradually normalize |
| Universal fingerprints | Read-only after seal; enhancements → side table/events |
| Strategy | Backfill `content_id` / seals asynchronously; do not rewrite fingerprints |
| Rollback | Ignore new columns; old readers unchanged |

---

# PART 8 — RETRIEVAL ENGINE MIGRATION

| | |
|--|--|
| **Current** | O(N) vector score; top-25 pool; patch often scoped; ORB top-K; filename CLIP |
| **Target** | Parallel recall: L1 hash, L3 LSH, L7 patch inverted, L9 ANN, L12 extract; union; then precision rank |
| **ANN / indexes** | Additive; start with patch + sha index; HNSW later |
| **Files** | `vault-similarity-vector.service.ts`, `vault-local-dna-search.service.ts`, `enterprise-retrieval-engine.service.ts`, `pinit-original-identity-recovery.service.ts`, `investigation-performance.ts`, `candidate-ranking-engine.service.ts` |
| **Risk** | Latency vs recall tradeoff — use flags for pool size |
| **Must not break** | Watermark/SHA instant identity; scenario crops |

---

# PART 9 — COMPARISON ENGINE MIGRATION

| | |
|--|--|
| **Current** | L1–L6 weighted; L7–L15 weight 0 / skip-credit; live vault regenerate |
| **Target** | Identity Engine compare L1–L10 with explicit weights; Ownership/Evidence compared in their engines; stored DNA authoritative |
| **Determinism** | Probe ephemeral only; vault from `StoredDnaFingerprinter` |
| **Thresholds/weights** | Keep policy file `investigation-match-policy.ts` as source; version as `acceptance-policy` / `dna-suite` |
| **Files** | `comparison-engine.ts`, `dna-comparison.service.ts`, `stored-dna-fingerprinter.service.ts`, `ephemeral-fingerprinter.ts`, `deep-vault-compare.service.ts` |
| **Risk** | Score band shifts → dual-run compare scores in logs before switching gates |

---

# PART 10 — ACCEPTANCE ENGINE MIGRATION

| | |
|--|--|
| **Current** | Mixed channels; instant WM/cert can verify without DNA; patch can verify without cert; timeline = dnaRecordId present |
| **Target** | Identity pack → content verdict support; Ownership pack → retainCandidate; Evidence pack → narrative/risk; never metadata-only / vault-lock-only ownership |
| **Verdicts KEEP** | `VERIFIED_ORIGINAL`, `VERIFIED_DERIVATIVE`, `POSSIBLE_MATCH`, `NOT_PINIT`, `INSUFFICIENT_EVIDENCE` |
| **FP risk mitigation** | Require identity + ownership factor for VERIFIED |
| **FN risk mitigation** | Don’t block WM by DNA DIFFERENT when mark cryptographically names `dna_id` |
| **Files** | `acceptance-engine.service.ts`, `acceptance-evidence.builder.ts`, `acceptance.types.ts`, ranking evidence helpers |
| **Strategy** | Shadow mode: log “would-verify” vs old verdict; then flag |
| **Tests** | Existing `tests/forensics/acceptance-engine.test.ts` expand |

---

# PART 11 — INVESTIGATION ENGINE MIGRATION

| | |
|--|--|
| **Current** | Recovery → vector → patch → deep live+registry → acceptance → orchestrator report |
| **Target** | Probe FP → Identity retrieval → load **stored** DNA → Identity compare → Ownership verify → Evidence attach → Acceptance → Report |
| **Authoritative identity** | `dna_id` package from DB |
| **Probe DNA** | Ephemeral / streaming only |
| **Ownership** | Cert + L12 extract + L14 (+ TEP bridge kept) |
| **Reports** | Prefer stable field names; add `identityScore`, `ownershipScore`, `evidenceSummary` additively |
| **Files** | `unified-investigation.orchestrator.ts`, `pinit-original-identity-recovery.service.ts`, `enterprise-recovery-pipeline.service.ts`, `leak-verify-authoritative-bridge.service.ts`, client `UnifiedInvestigationPage.tsx`, `forensic-report-display.ts` |

---

# PART 12 — FRONTEND IMPACT

| Page / area | Impact |
|-------------|--------|
| `UnifiedInvestigationPage` | **Minor UI** — channel grouping; keep SSE |
| `InvestigationLivePanel` / side-by-side | **Minor UI** |
| `GeneratePage` | **Minor UI** — show suite/versions when present |
| `DNARecordsPage` | **Minor UI** — version/integrity badges |
| `VaultPage` | **No Change** early; **Minor** later |
| `CertificatesPage` / Verify | **No Change** / **Minor** bind display |
| `AccessIntelligencePage` / Link intel | **No Change** |
| `MonitoringPage` | **No Change** |
| `ReportsPage` | **Minor** additive fields |
| `ComparePage` / ForensicDiff | **Minor** |
| Dashboard / Admin / Notifications / Profile | **No Change** |
| New “DNA Package” inspector | **New UI** (optional late milestone) |

Avoid Major UI until engines stable.

---

# PART 13 — TEST PLAN

## Cross-cutting gates (every milestone)

- Auth + tenant isolation smoke  
- Scenarios 1–5 (`docs/Scenario_*_Test.md`)  
- Generate → vault → cert → investigate happy path  
- Protect download investigate path  

## Per engine

| Phase | Unit | Integration | Regression | Perf | Acceptance | Scenario |
|-------|------|-------------|------------|------|------------|----------|
| Generation determinism | Same buffer → same L1–L6 seals | POST generate ×2 | Old verify | — | — | Upload demos |
| Storage seal | Refuse update when sealed (flag) | storage-audit | List DNA | — | — | — |
| Retrieval | Index hit fixtures | Crop recall@K | Lookalike | Pool latency | — | Crop scenarios |
| Comparison | Layer score fixtures | Stored vs probe | Score deltas logged | Deep timeout | — | Exact vs edit |
| Acceptance | Expand test matrix | Shadow vs old | Ownership FP/FN | — | Verdict labels | All five |
| Investigation | Orchestrator mocks | Full SSE | UI smoke | Soft timeout | retainCandidate | All five |

---

# PART 14 — RISK REGISTER

| Risk | Type | Mitigation |
|------|------|------------|
| Verdict drift after stored-DNA cutover | Breaking / FN | Dual-run + flag; scenario gate |
| Ownership FP if WM without identity | Security | Acceptance rule change with tests |
| Stopping JSON mutation breaks enhancement UX | Breaking | Feature parity via events |
| Additive columns unset on old rows | Migration | Null-safe readers; backfill job |
| Index build load | Performance | Offline backfill; rate limit |
| Seal prevents legitimate correction | Data | Supersede package, don’t update |
| Live FP removal before backfill seals | FN | Require dual-write complete % |
| Rollback incomplete | Rollback | Flags default to legacy path |
| Secret/key for content seal | Security | Use existing stego secret carefully; rotate plan |
| Dropping columns too early | Data loss | Late phase only |

---

# PART 15 — IMPLEMENTATION PHASES (MILESTONES)

| Phase | Scope | Complexity | Files (approx) | Regression risk | Testing |
|-------|-------|------------|----------------|-----------------|---------|
| **A — Contracts & flags** | Suite versions, flags, types for Identity/Ownership/Evidence | Low | config, types | Low | Unit + no behavior change |
| **B — DNA Generation determinism** | Dual-write L5 claims + L6 seal; stop random compare identity | Med–High | layers 5–6, orchestrator, engines | Med | Generate×2, compare |
| **C — DNA Storage seal** | Additive columns; stop self-learning DNA writes; audit | Med | orchestrator, self-learning, schema plan | Med | Storage audit, non-image |
| **D — Comparison SSoT** | Prefer stored DNA; live audit only | High | dna-comparison, deep-vault-compare, policy | **High** | Scenarios 1–5 |
| **E — Retrieval recall** | Union shortlist; don’t truncate before patch | Med | recovery, vector, local search, ranking | Med | Crops / lookalikes |
| **F — Acceptance split** | Ownership vs identity channels | High | acceptance-* , evidence builder | **High** | Acceptance tests + scenarios |
| **G — Investigation wiring** | Engine order; report additive fields | Med | orchestrator, client display | Med | Full investigate UX |
| **H — Ownership modules** | L12/L14 harden; TEP bridge keep | High | layers-11-15, tep, leak-verify | Med | Protect download |
| **I — Evidence modules** | L11/L13 + provenance | Med | provenance, custody | Low–Med | Timeline |
| **J — Monitoring / evidence reports** | Consume new fields only | Low | monitoring, evidence | Low | Smoke |
| **K — Optimization / 100M indexes** | LSH, ANN, partitions | High | new index services | Med | Perf |
| **L — Cleanup** | Deprecate live-primary; docs; optional column drop plan | Med | policy defaults | Med | Full regression |

Phases A→G are the **compatibility spine**. H→L strengthen architecture without blocking production.

---

# PART 16 — FINAL EXECUTION CHECKLIST

Each item: independently completable, testable, deployable behind flag, rollback = flag off / dual-read old fields.

### Milestone A — Contracts & flags
- [ ] A1 Add `dna-suite` / engine role constants (no behavior change)  
- [ ] A2 Add `PREFER_STORED_VAULT_DNA` flag default **false**  
- [ ] A3 Document module taxonomy in `docs/` (this blueprint)  
- [ ] **Test:** boot + existing e2e smoke  
- [ ] **Rollback:** revert flag commit  

### Milestone B — Generation determinism (dual-write)
- [ ] B1 Write `claims_digest` alongside L5  
- [ ] B2 Write `content_seal_hmac` alongside L6  
- [ ] B3 Keep old `metadataHash` / `payloadHmac` for compatibility  
- [ ] B4 Unit: same file → identical new digests  
- [ ] **Rollback:** stop writing new fields; readers ignore  

### Milestone C — Storage immutability (behavior)
- [ ] C1 Stop self-learning/transform **DNA JSON** updates (emit events)  
- [ ] C2 Optional seal flag on new records  
- [ ] C3 Extend storage-audit checks for new digests  
- [ ] **Test:** non-image generate; enhancements still observable via events  
- [ ] **Rollback:** re-enable writers behind flag  

### Milestone D — Comparison SSoT
- [ ] D1 When flag true: vault side = `StoredDnaFingerprinter` only for scoring  
- [ ] D2 Live regenerate = audit log / mismatch metric only  
- [ ] D3 Compare uses `claims_digest` / `content_seal` when present  
- [ ] **Test:** scenarios 1–5; exact match; WhatsApp crop  
- [ ] **Rollback:** flag false  

### Milestone E — Retrieval
- [ ] E1 Always include local-patch top vault in deep pool (already partial — harden)  
- [ ] E2 Raise/union recall before top-25 hard cut (flagged pool sizes)  
- [ ] E3 Metric: `true_vault_in_deep_pool` on labeled set  
- [ ] **Test:** lookalike + crop  
- [ ] **Rollback:** old pool constants  

### Milestone F — Acceptance
- [ ] F1 Build IdentityEvidence vs OwnershipEvidence packs  
- [ ] F2 VERIFIED requires identity + ownership factor  
- [ ] F3 Shadow-log old vs new verdict  
- [ ] F4 Expand `acceptance-engine.test.ts`  
- [ ] **Test:** WM-only, cert-only, patch-only, metadata-only  
- [ ] **Rollback:** flag legacy decide()  

### Milestone G — Investigation UX/API
- [ ] G1 Additive report fields; keep SSE ids  
- [ ] G2 Client display maps new fields optionally  
- [ ] **Test:** UnifiedInvestigationPage smoke  
- [ ] **Rollback:** UI ignores new fields  

### Milestone H — Ownership modules
- [ ] H1 Spec extractable watermark dual-run with TEP  
- [ ] H2 Deterministic ownership commitment dual-write  
- [ ] **Test:** protect download → investigate  
- [ ] **Rollback:** TEP-only path  

### Milestone I — Evidence modules
- [ ] I1 Provenance absorbs upload origin/behavior events  
- [ ] I2 Custody head pointer dual with custody_layers  
- [ ] **Test:** timeline still populates  
- [ ] **Rollback:** old layer rows remain  

### Milestone J — Downstream
- [ ] J1 Monitoring enroll unchanged  
- [ ] J2 Evidence reports read additive identity/ownership scores  
- [ ] **Test:** monitoring smoke  

### Milestone K — Scale
- [ ] K1 Hash index / content_id lookup  
- [ ] K2 Patch index operational SLOs  
- [ ] K3 ANN plan (pgvector/FAISS) — implement only when needed  
- [ ] **Test:** synthetic large vault perf  

### Milestone L — Cleanup (only after soak)
- [ ] L1 Default flag prefer stored DNA **true**  
- [ ] L2 Deprecate live-primary code path  
- [ ] L3 Plan column drops (separate breaking release)  
- [ ] **Test:** full regression + scenarios 1–5  
- [ ] **Rollback:** previous release artifact  

---

# Appendix A — Mapping current “15 layers” → target engines

| Module | Engine | Migration note |
|--------|--------|----------------|
| L1–L6 | Identity | Determinism + seal first |
| L7 Patch (elevate from local index) | Identity | Keep index code |
| L8 Family | Identity | Replace DB duplicate snapshot |
| L9 Cross-modal | Identity | ORB/CLIP descriptors stored at generate |
| L10 Lineage | Identity | Fix merkle leaves |
| Old behavioral/origin | Provenance (not DNA) | Relocate |
| L12, L14, L15 | Ownership | Separate acceptance pack |
| L11, L13 | Evidence | Separate pack |
| Acceptance | Acceptance | Keep verdict enum |

---

# Appendix B — Definition of done (program)

1. Same file + same suite → identical Identity module digests.  
2. Investigation identity path does not regenerate vault DNA when flag on.  
3. VERIFIED ownership requires Identity + Ownership evidence.  
4. Scenarios 1–5 green.  
5. No breaking API removals without versioned deprecation.  
6. Rollback always available via feature flags for A–G.

---

**End of Phase 9 Migration & Implementation Blueprint**  
**Next step (when approved):** Execute Milestone A only — still behind flags, still no production cutover.
