# PINIT-DNA — Enterprise DNA Specification (EDS)

**Document ID:** `PINIT-DNA-EDS-1.0`  
**Status:** FINAL — Permanent engineering contract  
**Supersedes:** All prior planning-only documents as the authoritative reference for implementation  
**Effective:** Upon engineering sign-off  
**Date:** 2026-07-16  

**Scope:** DNA Engine, Identity Engine, Ownership Engine, Evidence Engine, Acceptance Engine, Investigation pipeline, storage, retrieval, comparison, versioning, security, performance, testing.

**Explicit non-scope of this document:** Implementation code, database migrations, API payloads, deployment procedures (see Phase 9 blueprint for migration mechanics).

---

# PART 1 — SYSTEM PRINCIPLES

These principles are **permanent**. No implementation may violate them without a new EDS revision.

| ID | Principle | Definition |
|----|-----------|------------|
| **P1** | **DNA is immutable** | A sealed DNA Package is a write-once artifact. No UPDATE, DELETE, or in-place rewrite of module fingerprints after `storage_status = SEALED`. Corrections require a new package with `supersedes_dna_id`. |
| **P2** | **DNA never changes after generation** | Generation produces the final identity artifact. Post-seal mutations (self-learning, transform append, JSON merge) are forbidden on DNA storage. |
| **P3** | **Stored DNA is the single source of truth (SSoT)** | Investigation, comparison, ranking acceptance, and reports **read** sealed stored DNA for vault/original identity. |
| **P4** | **Probe DNA is always ephemeral** | Suspect uploads generate transient fingerprints only. Probe DNA is never persisted as vault identity. |
| **P5** | **Investigation never regenerates vault DNA** | Vault bytes may be decrypted for UI, watermark extraction, or integrity cross-check — never to replace stored module fingerprints for scoring. |
| **P6** | **Identity ≠ Ownership ≠ Evidence** | Three forensic questions are answered by three engines. Modules are classified accordingly. |
| **P7** | **Ownership never overrides identity** | A watermark, certificate, or subject bind **cannot** assign ownership if Identity Engine concludes DIFFERENT / no content match (unless cryptographically bound payload names the same `content_id` and binding is verified). |
| **P8** | **Evidence never overrides ownership** | Risk scores and custody records inform narrative and tier modifiers; they do not grant ownership. |
| **P9** | **Acceptance is the sole ownership assigner** | Only Acceptance Engine may set `retain_candidate = true` and authorize owner/certificate visibility. |
| **P10** | **Determinism** | Same canonical input bytes + same version tuple ⇒ identical module outputs (except non-hashed metadata like `generated_at`). |
| **P11** | **Version everything** | Every package and module records DNA, Algorithm, Fingerprint, Generator, Schema, and Comparison suite versions. |
| **P12** | **Universal media** | One package contract; media-specific adapters implement the same 15 module slots. |
| **P13** | **Recall before precision** | Retrieval must not discard true vault candidates before deep Identity comparison. |
| **P14** | **Fail closed on ownership** | When evidence is insufficient, verdict is `UNKNOWN` or `INSUFFICIENT_EVIDENCE` — never silent ownership. |
| **P15** | **Tenant isolation** | All DNA, retrieval, and investigation operations are scoped to `owner_tenant_id`. |
| **P16** | **Provenance is append-only** | Session, upload origin, access, and lifecycle events live in provenance/custody ledgers — not in Identity module fingerprints. |

---

# PART 2 — 15 DNA MODULE SPECIFICATION

**Naming:** Official term is **DNA Module** (not “layer”). Module numbers L1–L15 are stable public identifiers.

**Engine assignment:**

| Engine | Modules |
|--------|---------|
| Identity | L1, L2, L3, L4, L5, L6, L7, L8, L9, L10 |
| Ownership | L12, L14, L15 |
| Evidence | L11, L13 |

---

## L1 — Cryptographic Bitstream Identity

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Prove canonical bitstream identity of uploaded media. |
| **Input** | `canonical_bytes` after media adapter normalization. |
| **Algorithm** | `content_id = SHA-256(canonical_bytes)`; optional `bitstream_id = SHA-256(raw_upload_bytes)` stored as aux. |
| **Output** | `content_id` (64 hex); optional `bitstream_id` (64 hex). |
| **Storage** | Identity module row: `fingerprint = content_id`; aux: `bitstream_id`. Hub column `dna_packages.content_id`. |
| **Version** | `algorithm_id`: e.g. `L1-sha256-v1`. |
| **Comparison** | **BINARY** equality on `content_id`. |
| **Acceptance role** | Identity channel; exact match enables `VERIFIED_ORIGINAL` path with other gates. |
| **Investigation role** | O(1) hash index lookup; highest-priority recall shortcut. |
| **Determinism** | **YES** — same canonical bytes. |
| **Failure behaviour** | Module `FAILED` → package cannot seal; investigation treats as no identity anchor. |
| **Scalability** | Hash index `(tenant_id, content_id) → dna_id`. |
| **Backward compatibility** | Legacy `sha256Hash` maps to `bitstream_id`; compare policy may use `content_id` when present. |
| **Future extensibility** | Add BLAKE3 parallel digest under new `algorithm_id`; never replace SHA-256 without new suite. |

---

## L2 — Structural Geometry

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Prove spatial / document / schema structure similarity. |
| **Input** | Structural view: edge grid (image), page tree (PDF), schema signature (CSV/JSON), container manifest (ZIP), keyframe grid (video). |
| **Algorithm** | Suite-pinned: e.g. `L2-sobel-8x8-v1` → 64-bit edge signature; document adapters use deterministic tree hash. |
| **Output** | Primary `structural_signature` (fixed-width hex); optional multi-scale sketches in aux. |
| **Storage** | Module row + optional sketch sidecar. |
| **Version** | `algorithm_id` per media adapter. |
| **Comparison** | **GRADED** — Hamming / tree distance; `similarity_fn_id = L2-hamming-v1`. |
| **Acceptance role** | Contributes to Identity similarity score. |
| **Investigation role** | LSH bucket index for recall. |
| **Determinism** | **YES** under pinned decoder + suite. |
| **Failure behaviour** | `SKIPPED` if media unsupported; does not block seal. |
| **Scalability** | Sketch LSH; no full-table scan. |
| **Backward compatibility** | Legacy `edgeSignature64` maps to primary signature. |
| **Future extensibility** | New `algorithm_id` for 128-bit structural sketch. |

---

## L3 — Perceptual / Content Similarity

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Near-duplicate visual or textual content similarity. |
| **Input** | Canonical raster / text window / audio chromaprint input. |
| **Algorithm** | Image: DCT pHash suite (`pHash64`, `aHash64`, `dHash64`); Text: SimHash; Audio: Chromaprint sketch — all suite-pinned. |
| **Output** | Primary `perceptual_hash` (compare); aux multi-hash bundle. |
| **Storage** | Module row; aux stores full bundle. |
| **Version** | `fingerprint_version` e.g. `phash-dct-64-v1`. |
| **Comparison** | **GRADED** Hamming; weighted blend in `comparison_version`. |
| **Acceptance role** | Primary Identity signal; L3 gates (e.g. ≥70% for POSSIBLE without patch). |
| **Investigation role** | Hamming LSH + vector recall; core ranking signal. |
| **Determinism** | **YES** under pinned suite. |
| **Failure behaviour** | `FAILED` on corrupt media; probe may `PROBE_ABSENT`. |
| **Scalability** | Multi-probe LSH tables; primary scale index. |
| **Backward compatibility** | Legacy `pHash64` = primary. |
| **Future extensibility** | `pHash256` as aux; new suite id. |

---

## L4 — Distribution Sketch

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Colour / topic / spectral distribution fingerprint (formerly “semantic” for images). |
| **Input** | Histograms, TF sketch, spectral bands. |
| **Algorithm** | Fixed-bin histogram fingerprint or sparse topic sketch; optional embedding ref to vector index. |
| **Output** | `distribution_fingerprint` (hex); optional `embedding_ref` (pointer, not inline vector at 100M scale). |
| **Storage** | Module row; vector index row keyed by `dna_id`. |
| **Version** | `algorithm_id` e.g. `L4-hist-8bin-v1`. |
| **Comparison** | **GRADED** intersection / cosine on sketch. |
| **Acceptance role** | Secondary Identity weight. |
| **Investigation role** | Optional ANN on embedding_ref. |
| **Determinism** | **YES** for sketch; embedding requires pinned model weights. |
| **Failure behaviour** | `SKIPPED` for unsupported media. |
| **Scalability** | Vector ANN per tenant. |
| **Backward compatibility** | Legacy `colorFingerprint` maps to sketch. |
| **Future extensibility** | True semantic embeddings as new `algorithm_id`. |

---

## L5 — Embedded Provenance Claims

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | File-native provenance (EXIF, XMP, C2PA, PDF Info) — **not** upload session. |
| **Input** | Parsed embedded claims only (device, capture time, creator tool, GPS if present). |
| **Algorithm** | `claims_digest = SHA-256(canonical_json(claims))` — **excludes** `dna_id`, `generated_at`, record UUID. |
| **Output** | `claims_digest` + structured `claims` aux. |
| **Storage** | Module row; aux holds claims JSON. |
| **Version** | `algorithm_id` e.g. `L5-exif-claims-v1`. |
| **Comparison** | **BINARY** on digest; optional field-wise graded aux. |
| **Acceptance role** | Weak Identity support; **never** sole ownership. |
| **Investigation role** | Corroboration filter. |
| **Determinism** | **YES** for same embedded claims. |
| **Failure behaviour** | `PROBE_ABSENT` / `VAULT_ABSENT` if stripped — not a failure. |
| **Scalability** | Stored inline; no index required. |
| **Backward compatibility** | Legacy `metadataHash` deprecated; map via migration flag. |
| **Future extensibility** | C2PA assertion parser versions as new `algorithm_id`. |

---

## L6 — Content Integrity Seal

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Deterministic seal over Identity modules L1–L5 proving package integrity at generation. |
| **Input** | Ordered module digests L1–L5 + `media_type` + suite id. |
| **Algorithm** | `content_seal = HMAC-SHA256(K_seal, "SEAL:v1:" ‖ media ‖ digest_L1 ‖ … ‖ digest_L5)`. |
| **Output** | 64-hex seal. |
| **Storage** | Module row `fingerprint = content_seal`. |
| **Version** | `algorithm_id` e.g. `L6-content-seal-v1`. |
| **Comparison** | **BINARY** — mismatch indicates tampered storage or wrong package. |
| **Acceptance role** | Integrity gate before trusting stored DNA. |
| **Investigation role** | Validate package before compare. |
| **Determinism** | **YES**. |
| **Failure behaviour** | Seal mismatch → `validation_status = INVALID`; investigation falls back to live integrity check on vault bytes vs `content_id` only. |
| **Scalability** | O(1) per package. |
| **Backward compatibility** | Legacy random `payloadHmac` not used for compare; optional trace embed is separate artifact. |
| **Future extensibility** | `SEAL:v2` with new `algorithm_id`. |

**Note:** Traceability embed (LSB/DCT unique nonce) is **not** L6 compare fingerprint; it may live under Ownership trace subsystem.

---

## L7 — Local Patch DNA (Fragment Identity)

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Identify crops, screenshots, and partial fragments of the same content. |
| **Input** | Multi-scale patch grid of canonical image / video keyframes. |
| **Algorithm** | Patch pHash/dHash/edge/color sketches; spatial voting; suite-pinned grid parameters. |
| **Output** | `patch_set_digest` + pointer to patch index partition (`patch_index_ref`). |
| **Storage** | Module row + `patch_index` tables (postings). |
| **Version** | `algorithm_id` e.g. `L7-patch-grid-v2`. |
| **Comparison** | **GRADED** vote score (match ratio, spatial consistency, coverage). |
| **Acceptance role** | Identity fragment lock; supports `VERIFIED_DERIVATIVE` with Ownership factor. |
| **Investigation role** | **Primary crop retrieval** via inverted patch index. |
| **Determinism** | **YES** under pinned grid/scales. |
| **Failure behaviour** | `SKIPPED` for non-visual media. |
| **Scalability** | Inverted index `patch_hash → (dna_id, grid)`; shard by tenant + prefix. |
| **Backward compatibility** | Existing `LocalFeatureIndex` / `LocalDnaPatch` maps to L7. |
| **Future extensibility** | New scales via new `fingerprint_version`. |

---

## L8 — Content Family

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Deterministic content-family identifier for near-duplicate clustering — not DB-time duplicate lists. |
| **Input** | `content_id` (L1) + primary perceptual bucket (L3). |
| **Algorithm** | `family_id = SHA-256("FAM:v1" ‖ L3_bucket ‖ L1_prefix)`. |
| **Output** | `family_id` (64 hex). |
| **Storage** | Module row. |
| **Version** | `algorithm_id` e.g. `L8-family-v1`. |
| **Comparison** | **BINARY** equality on `family_id`. |
| **Acceptance role** | Soft prior for candidate expansion. |
| **Investigation role** | Family index `family_id → dna_id[]`. |
| **Determinism** | **YES** — no dependency on other records existing at generate time. |
| **Failure behaviour** | `SKIPPED` if L1/L3 absent. |
| **Scalability** | Secondary index; optional offline reclusters create new family packages only via supersede. |
| **Backward compatibility** | Legacy relationship `graphHash` from duplicate query deprecated. |
| **Future extensibility** | Graph edges in external Relation service. |

---

## L9 — Cross-Modal Descriptor

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Descriptor stable across transcodes (still ↔ video keyframe, screenshot ↔ original). |
| **Input** | Canonical frames / spectrogram summary. |
| **Algorithm** | Pinned ORB global descriptor or embedding model; stored at generate. |
| **Output** | `descriptor_ref` → vector index row; optional compact hex sketch in module row. |
| **Storage** | Module row + vector index. |
| **Version** | `algorithm_id` + model SHA in aux. |
| **Comparison** | **GRADED** cosine / Hamming on descriptor. |
| **Acceptance role** | Visual Identity channel input. |
| **Investigation role** | ANN retrieval top-K. |
| **Determinism** | **YES** with pinned model + deterministic inference mode. |
| **Failure behaviour** | `SKIPPED` if model unavailable at generate → package may still seal without L9. |
| **Scalability** | HNSW/IVF per tenant. |
| **Backward compatibility** | ORB refine at investigate time is **supplemental only**, not SSoT. |
| **Future extensibility** | New model = new `algorithm_id`. |

---

## L10 — Derivation Lineage Head

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Record derivation relationship (original vs derivative packages). |
| **Input** | `content_id`, optional `parent_dna_id`, `relation_type` enum. |
| **Algorithm** | Merkle leaf = `SHA-256(content_id ‖ parent_dna_id ‖ relation_type)` — **no wall-clock in leaf**; `lineage_merkle_head` stored. |
| **Output** | `lineage_merkle_head`, `parent_dna_id?`, `relation_type`. |
| **Storage** | Module row. |
| **Version** | `algorithm_id` e.g. `L10-lineage-v1`. |
| **Comparison** | **BINARY** head match; path proofs as evidence. |
| **Acceptance role** | Tier modifier (ORIGINAL vs DERIVATIVE). |
| **Investigation role** | Lineage walk via index on `parent_dna_id`. |
| **Determinism** | **YES**. |
| **Failure behaviour** | Default ORIGIN if no parent. |
| **Scalability** | Index on parent pointer. |
| **Backward compatibility** | Legacy evolution `mutationLog` with timestamps not used for compare. |
| **Future extensibility** | Append new child packages only; never rewrite parent. |

---

## L11 — Synthetic / Manipulation Risk

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Calibrated risk that media is AI-generated or heavily manipulated. |
| **Input** | Canonical media bytes / frames. |
| **Algorithm** | Versioned model `model_id@sha256` + deterministic inference; outputs score 0–100 + feature digest. |
| **Output** | `risk_score`, `model_id`, `feature_digest`. |
| **Storage** | Evidence module row. |
| **Version** | `algorithm_id` binds model. |
| **Comparison** | **GRADED** only if same `model_id`; else `INCOMPARABLE`. |
| **Acceptance role** | Evidence — risk modifier; never creates ownership. |
| **Investigation role** | Tamper narrative; may influence DERIVATIVE tier. |
| **Determinism** | **YES** under pinned model deterministic mode. |
| **Failure behaviour** | `SKIPPED` if model offline. |
| **Scalability** | Generate-time only; no retrieval index. |
| **Backward compatibility** | Legacy heuristic score mapped with `model_id = heuristic-v1`. |
| **Future extensibility** | New models as new evidence suite versions. |

---

## L12 — Recoverable Ownership Mark

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Extractable mark encoding tenant + content binding for ownership proof. |
| **Input** | Canonical media + deterministic payload `mark_payload_id`. |
| **Algorithm** | Suite-pinned DCT / psychoacoustic / structural embed; PRNG **seeded by content_id** for deterministic embed. |
| **Output** | `mark_payload_id`, `mark_algorithm_id`, `embed_proof_digest`; extraction yields payload. |
| **Storage** | Ownership module row. |
| **Version** | `algorithm_id` e.g. `L12-dct-mark-v1`. |
| **Comparison** | **BINARY** extracted payload vs stored; survival score graded optional. |
| **Acceptance role** | Ownership channel — strong factor when extract succeeds. |
| **Investigation role** | Instant identity shortcut when mark decodes to `dna_id`. |
| **Determinism** | **YES** for embed given content_id seed. |
| **Failure behaviour** | `NOT_RECOVERABLE` — does not imply NOT_PINIT. |
| **Scalability** | Extract is O(1) per candidate; index by payload id. |
| **Backward compatibility** | TEP / protected-download channels remain parallel until mark unified. |
| **Future extensibility** | New mark suite without invalidating old extractions. |

---

## L13 — Custody Anchor

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Immutable pointer to append-only custody ledger head at seal time. |
| **Input** | `ledger_id`, `ledger_head_hash` from Custody Ledger service. |
| **Algorithm** | Store head hash; proofs via ledger API. |
| **Output** | `custody_head`, `ledger_id`. |
| **Storage** | Evidence module row. |
| **Storage** | Evidence module row; ledger lives externally. |
| **Version** | `algorithm_id` e.g. `L13-custody-anchor-v1`. |
| **Comparison** | **BINARY** head equality; chain proofs as evidence. |
| **Acceptance role** | Evidence / timeline channel. |
| **Investigation role** | Custody narrative in report. |
| **Determinism** | Head fixed at seal; ledger grows externally. |
| **Failure behaviour** | `SKIPPED` if ledger unavailable — package may still seal. |
| **Scalability** | O(1) per package. |
| **Backward compatibility** | Legacy inline `custodyChain` JSON read-only for old packages. |
| **Future extensibility** | Multi-jurisdiction ledger ids. |

---

## L14 — Ownership Commitment

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Cryptographic binding of owner to `content_id` without per-upload random secret. |
| **Input** | `content_id`, `owner_key_id`, tenant. |
| **Algorithm** | `commitment = SHA-256(KDF(owner_root_key, content_id) ‖ content_id ‖ owner_key_id)` — suite-pinned KDF. |
| **Output** | `commitment_hash`, `public_verify_material`. |
| **Storage** | Ownership module row. |
| **Version** | `algorithm_id` e.g. `L14-commit-v1`. |
| **Comparison** | **BINARY** verify. |
| **Acceptance role** | Ownership channel. |
| **Investigation role** | Binding check after Identity match. |
| **Determinism** | **YES**. |
| **Failure behaviour** | `SKIPPED` if owner key unavailable. |
| **Scalability** | O(1). |
| **Backward compatibility** | Legacy random ZK secret packages remain verify-only under old suite. |
| **Future extensibility** | BLS/SNARK upgrade as new `algorithm_id`. |

---

## L15 — Subject Bind (Optional)

| Attribute | Specification |
|-----------|---------------|
| **Purpose** | Optional bind to specific person/org (biometric or org credential). |
| **Input** | Opaque `subject_bind_id` from Identity service — **not** raw embedding in DNA. |
| **Algorithm** | `bind_digest = SHA-256(subject_bind_id ‖ content_id ‖ policy_id)`. |
| **Output** | `bind_digest`, `bind_type`. |
| **Storage** | Ownership module row. |
| **Version** | `algorithm_id` e.g. `L15-subject-bind-v1`. |
| **Comparison** | **BINARY** if probe provides bind; else `PROBE_ABSENT`. |
| **Acceptance role** | Optional ownership boost. |
| **Investigation role** | Rare; enterprise accounts. |
| **Determinism** | **YES** given same bind id. |
| **Failure behaviour** | `NOT_REGISTERED` — optional module. |
| **Scalability** | O(1). |
| **Backward compatibility** | Legacy `biometricHash` from face embedding maps under migration. |
| **Future extensibility** | Hardware key bind types. |

---

# PART 3 — ENGINE CONTRACTS

## 3.1 Identity Engine

| | |
|--|--|
| **Responsibilities** | Canonicalize probe/vault bytes; generate Identity modules at seal; compare probe vs stored Identity modules; produce `identity_score`, `identity_classification`, per-module similarities. |
| **Inputs** | Probe `MediaObject`; stored `DnaPackage` Identity modules; `comparison_version`. |
| **Outputs** | `IdentityResult`: scores, classification (`DNA_MATCH` \| `SIMILAR` \| `DIFFERENT`), module breakdown, candidate `dna_id` list from retrieval. |
| **Dependencies** | Media adapters, Comparison functions registry, retrieval indexes. |
| **Interfaces** | `identity.generate(manifest)`, `identity.compare(probe, package)`, `identity.retrieve(probe, tenant)`. |
| **MUST NOT** | Assign ownership; reveal owner PINIT; verify certificates; write sealed DNA; regenerate vault DNA for scoring. |

## 3.2 Ownership Engine

| | |
|--|--|
| **Responsibilities** | Verify L12 extraction, L14 commitment, L15 bind; verify certificate binding to `content_id`/`dna_id`; produce `ownership_evidence` pack. |
| **Inputs** | Stored Ownership modules; certificate record; extracted mark from probe/vault bytes; tenant context. |
| **Outputs** | `OwnershipResult`: per-channel PASS/FAIL/SKIPPED, scores, `ownership_factors[]`. |
| **Dependencies** | Certificate service, TEP/watermark extractors, key management. |
| **Interfaces** | `ownership.verify(probe, package, cert?)`. |
| **MUST NOT** | Override Identity DIFFERENT without cryptographic binding to same content; assign final verdict; perform retrieval ranking alone. |

## 3.3 Evidence Engine

| | |
|--|--|
| **Responsibilities** | Attach L11 risk, L13 custody anchor verification, provenance event summaries; tamper narrative. |
| **Inputs** | Stored Evidence modules; custody ledger API; provenance events. |
| **Outputs** | `EvidenceResult`: risk level, custody status, tamper indicators, legal usability flags. |
| **Dependencies** | Provenance service, custody ledger, tamper classifier. |
| **Interfaces** | `evidence.collect(dna_id, investigation_id)`. |
| **MUST NOT** | Grant ownership; change Identity scores; mutate DNA. |

## 3.4 Acceptance Engine

| | |
|--|--|
| **Responsibilities** | Fuse Identity + Ownership + Evidence into **sole legal verdict**; set `retain_candidate`, visibility rules, confidence, display labels. |
| **Inputs** | `IdentityResult`, `OwnershipResult`, `EvidenceResult`, `analysis_complete` flag. |
| **Outputs** | `AcceptanceDecision` (verdict enum, confidence, scorecard, reason, policy version). |
| **Dependencies** | `acceptance_version` policy table. |
| **Interfaces** | `acceptance.decide(packs)`. |
| **MUST NOT** | Generate fingerprints; retrieve candidates; read vault bytes except via provided packs; bypass Identity for VERIFIED. |

---

# PART 4 — DATA CONTRACT

## 4.1 DNA Package (immutable record)

Every sealed package **MUST** contain:

| Field | Type | Immutable after SEALED? | Notes |
|-------|------|---------------------------|-------|
| `dna_id` | UUID or content-addressed id | **YES** | Primary key |
| `content_id` | SHA-256 hex | **YES** | L1 canonical identity |
| `owner_tenant_id` | UUID | **YES** | Tenant scope |
| `media_type` | enum | **YES** | |
| `dna_version` | semver/int | **YES** | Package revision |
| `schema_version` | semver | **YES** | Structure contract |
| `algorithm_version` | suite id | **YES** | e.g. `dna-suite-2026.1` |
| `fingerprint_version` | suite id | **YES** | Construction ids |
| `generator_version` | semver | **YES** | Build binary |
| `comparison_version` | id | **YES** | Weights/thresholds id |
| `acceptance_version` | id | **YES** | Policy id used at investigate |
| `generated_at` | ISO8601 | **YES** | Metadata only — not in module hashes |
| `integrity_merkle_root` | hex | **YES** | Over L1–L15 module digests |
| `integrity_hash` | hex | **YES** | Over header + merkle |
| `storage_status` | enum | **YES** after SEALED | `PENDING`→`SEALED` once |
| `validation_status` | enum | **YES** after set | `VALID` \| `INVALID` \| `PENDING` |
| `owner_reference` | opaque id | **YES** | Account owner at seal |
| `certificate_reference` | cert id? | **YES** | If issued at seal |
| `vault_object_reference` | vault id? | **YES** | Pointer to ciphertext |
| `supersedes_dna_id` | id? | **YES** | Lineage |
| `modules[1..15]` | array | **YES** | See module row contract |

**Mutable forbidden:** Any module fingerprint, digest, merkle root, version fields, `content_id`.

**Allowed post-seal:** External indexes, provenance events, investigation logs, monitoring enrollment — never DNA package rows.

## 4.2 Module row contract

Each module **MUST** store: `module_id`, `engine`, `algorithm_id`, `fingerprint_version`, `fingerprint`, `fingerprint_encoding`, `aux` (optional), `layer_digest`, `compare_mode`, `status`.

---

# PART 5 — INVESTIGATION CONTRACT

Official pipeline — stage ownership:

```text
1. Probe Upload              → API / Investigation Orchestrator
2. Probe Fingerprinting      → Identity Engine (ephemeral only)
3. Identity Retrieval        → Identity Engine (indexes: L1,L3,L7,L9,L12 extract)
4. Stored DNA Retrieval      → DNA Storage (by dna_id — SSoT)
5. Identity Comparison       → Identity Engine (15 Identity modules L1–L10)
6. Ownership Verification    → Ownership Engine (L12,L14,L15 + Certificate)
7. Evidence Verification     → Evidence Engine (L11,L13 + Provenance)
8. Acceptance                → Acceptance Engine
9. Verdict                     → Acceptance output
10. Report                     → Investigation Orchestrator (read-only formatting)
```

| Stage | Owns | Must not |
|-------|------|----------|
| Probe Fingerprinting | Ephemeral probe modules | Persist as vault DNA |
| Identity Retrieval | Candidate recall union | Truncate true vault before compare |
| Stored DNA Retrieval | Load sealed package | Regenerate from vault bytes |
| Identity Comparison | Content similarity | Assign ownership |
| Ownership Verification | Ownership factors | Override Identity without binding proof |
| Evidence Verification | Risk/custody narrative | Grant ownership |
| Acceptance | Verdict + visibility | Generate fingerprints |
| Report | Display | Change verdict |

**Vault bytes:** Decrypt allowed for UI preview, L12 extract, `content_id` integrity check — **not** for Identity module regeneration.

---

# PART 6 — ACCEPTANCE CONTRACT

**Legal verdicts (frozen enum):**

| Verdict | Code name in API |
|---------|------------------|
| Verified original | `VERIFIED_ORIGINAL` |
| Verified derivative | `VERIFIED_DERIVATIVE` |
| Possible match | `POSSIBLE_MATCH` |
| Unknown | `UNKNOWN` (maps legacy `NOT_PINIT`) |
| Insufficient evidence | `INSUFFICIENT_EVIDENCE` |

## 6.1 VERIFIED_ORIGINAL

| Attribute | Requirement |
|-----------|-------------|
| **Identity** | L1 exact **or** (L3 ≥ threshold AND L6 seal valid) AND Identity classification not DIFFERENT |
| **Ownership** | ≥1 factor: L12 extract match **or** L14 verify **or** valid certificate bound to same `dna_id`/`content_id` |
| **Evidence** | No blocking INVALID validation_status |
| **Confidence** | `max(identity_score, ownership_score)` capped 100; fusion ≥ policy minimum (default 90) |
| **Owner visibility** | **REVEAL** — `retain_candidate = true` |
| **Certificate visibility** | **REVEAL** if bound |
| **Investigation behaviour** | Full report; owner PINIT; vault/DNA ids |

## 6.2 VERIFIED_DERIVATIVE

| Attribute | Requirement |
|-----------|-------------|
| **Identity** | Strong fragment (L7) **or** high L3 with tamper/derivative signals; Identity not DIFFERENT without patch |
| **Ownership** | Same ownership factor as ORIGINAL |
| **Evidence** | Tamper or derivative relation (L10 child, L11 elevated risk acceptable) |
| **Confidence** | ≥ policy derivative minimum (default 75) |
| **Owner visibility** | **REVEAL** with derivative label |
| **Certificate visibility** | **REVEAL** if bound |
| **Investigation behaviour** | Tamper indicators shown; derivative wording |

## 6.3 POSSIBLE_MATCH

| Attribute | Requirement |
|-----------|-------------|
| **Identity** | Identity score ≥ 55 with content gates (L3/patch per policy) |
| **Ownership** | **Not required** |
| **Evidence** | Any |
| **Confidence** | Similarity band 55–89 |
| **Owner visibility** | **WITHHOLD** — `retain_candidate = false` |
| **Certificate visibility** | **WITHHOLD** |
| **Investigation behaviour** | Vault/DNA ids for manual review per product policy; no owner PINIT |

## 6.4 UNKNOWN

| Attribute | Requirement |
|-----------|-------------|
| **Identity** | No candidate **or** Identity DIFFERENT without patch **or** below not-found floor |
| **Ownership** | N/A |
| **Confidence** | 0 for ownership; closest similarity may display |
| **Owner visibility** | **NONE** |
| **Certificate visibility** | **NONE** |
| **Investigation behaviour** | “No verified vault owner”; optional closest % |

## 6.5 INSUFFICIENT_EVIDENCE

| Attribute | Requirement |
|-----------|-------------|
| **Trigger** | `analysis_complete = false` (timeout, corrupt, missing tools) |
| **Owner visibility** | **NONE** |
| **Investigation behaviour** | Manual review recommended; partial data if policy allows |

**Permanent rules:**

- Metadata-only (L5) → never VERIFIED  
- Vault lock alone → never VERIFIED  
- Visual-only without Identity DNA partial → never VERIFIED (POSSIBLE at most)

---

# PART 7 — VERSIONING CONTRACT

| Version | Meaning | Changes when |
|---------|---------|--------------|
| `schema_version` | Package JSON/table shape | Breaking structure |
| `dna_version` | Logical package revision | Any re-issue |
| `algorithm_version` | Suite of all module algorithms | Any module algorithm change |
| `fingerprint_version` | Fingerprint construction | Per-module or suite |
| `generator_version` | Generator binary semver | Deploy |
| `comparison_version` | Weights, thresholds, similarity fns | Policy tuning |
| `acceptance_version` | Verdict policy | Policy tuning |

**Upgrade process:**

1. Publish new suite id.  
2. New uploads seal under new suite.  
3. Old packages remain valid forever.  
4. Compare uses **stored package’s** `comparison_version` for stored side; probe uses current suite if newer — cross-suite adapters in registry.  
5. Supersede optional: new package links `supersedes_dna_id`.

**Legacy DNA:** Readable indefinitely; compare may use legacy adapter mapping (Phase 9); never auto-rewrite.

---

# PART 8 — BACKWARD COMPATIBILITY

| Rule | Specification |
|------|---------------|
| **Read old packages** | All `schema_version` supported by adapter registry for N major versions |
| **Compare across versions** | Stored side frozen to its suite; probe side current; crosswalk table maps legacy fields (`sha256Hash`→`content_id`, `colorFingerprint`→L4, etc.) |
| **API responses** | Additive fields only in minor releases; removals require deprecation + `schema_version` bump |
| **Deprecation** | Minimum 2 release cycles with dual-read before field removal |
| **Migration** | Backfill additive columns async; never block seal on backfill |
| **Investigation** | Feature flag legacy path until soak complete; then default SSoT |

---

# PART 9 — PERFORMANCE CONTRACT

Targets are **p95 investigation latency** per tenant vault size (single-tenant scope). Retrieval must be **sub-linear** — no full-table scan.

| Vault size | Storage | Retrieval (recall stage) | Identity compare (top-K) | Full investigation | Monitoring |
|------------|---------|--------------------------|--------------------------|-------------------|------------|
| **100** | < 2s seal | < 500ms | < 2s × K≤10 | < 15s | < 5s check |
| **1K** | < 3s seal | < 800ms | < 3s × K≤10 | < 20s | < 5s |
| **10K** | < 5s seal | < 1.5s | < 4s × K≤15 | < 30s | < 10s |
| **100K** | < 8s seal | < 2.5s | < 5s × K≤15 | < 45s | < 15s |
| **1M** | < 10s seal | < 4s (indexed) | < 6s × K≤20 | < 60s | < 20s |
| **10M** | < 12s seal | < 6s | < 8s × K≤20 | < 90s | async |
| **100M** | < 15s seal | < 8s | < 10s × K≤20 | < 120s | async |

**Requirements at scale:**

- Hash index for L1  
- Hamming LSH for L3  
- Inverted patch index for L7  
- HNSW/IVF for L9/L4 embeddings  
- Shard by `tenant_id`  
- Candidate union before top-N truncate  
- Async patch index build after seal acceptable (package SEALED before index COMPLETE)

---

# PART 10 — SECURITY CONTRACT

| Control | Specification |
|---------|---------------|
| **Integrity** | `integrity_merkle_root` + `integrity_hash`; L6 content seal; validate before compare |
| **Immutability** | Application-enforced SEALED; audit on violation attempts |
| **Tamper detection** | L6 mismatch; L1 vs vault decrypt hash; Identity DIFFERENT; Evidence L11 |
| **Ownership verification** | Ownership Engine only; cryptographic binding required |
| **Evidence chain** | L13 custody anchor + append-only provenance |
| **Replay protection** | Investigation sessions use `investigation_id`; marks/certs bind `content_id` + time window where applicable |
| **Hash verification** | `content_id` recomputed from vault decrypt must match package for VERIFIED |
| **Watermark verification** | L12 extract + TEP bridge must resolve same `dna_id` |
| **Certificate verification** | Public verify endpoint; bind cert to `dna_id`/`content_id` |
| **Secrets** | Seal keys in KMS; never in DNA package |
| **Tenant isolation** | All queries filtered `owner_tenant_id` |

---

# PART 11 — TESTING CONTRACT

Every module **MUST** have:

| Test type | Requirement |
|-----------|-------------|
| **Unit** | Determinism: same input → same output × 2; failure modes |
| **Integration** | Generate → seal → load → compare round-trip |
| **Regression** | Golden vectors per `algorithm_id` (frozen fixtures) |
| **Acceptance** | Verdict matrix per `acceptance_version` |
| **Performance** | Seal and compare within SLA for size tier |
| **Scenario** | All five demo scenarios (`docs/Scenario_1_Test.md` … `Scenario_5_Test.md`) green |

**Engine-level gates:**

- Identity: no ownership in output  
- Ownership: no verdict in output  
- Acceptance: shadow mode parity logging during migration  
- Investigation: stored DNA path never calls vault ephemeral generate for score

---

# PART 12 — DEFINITION OF DONE

Implementation is **complete** only when **all** are true:

| # | Criterion |
|---|-----------|
| 1 | All 15 modules implement EDS contract with pinned `algorithm_id` |
| 2 | All module unit + integration + regression tests pass |
| 3 | Identity Engine SSoT — investigation does not regenerate vault DNA for scoring |
| 4 | Same file + same suite → identical sealed package (determinism suite green) |
| 5 | Acceptance verdicts behave per Part 6 across full matrix |
| 6 | Five demo scenarios pass on localhost and production |
| 7 | Backward compatibility: legacy packages readable and comparable via adapters |
| 8 | Performance SLAs met for 10K and 100K tiers minimum before 1M rollout |
| 9 | Security: integrity validation on all investigate paths |
| 10 | No post-seal DNA mutation in production logs (audit) |
| 11 | Phase 9 migration milestones A–L complete or explicitly deferred with EDS amendment |
| 12 | Engineering sign-off on this EDS version |

---

# APPENDIX A — Document hierarchy

| Document | Role |
|----------|------|
| **PHASE10_ENTERPRISE_DNA_SPECIFICATION.md (this)** | Permanent contract — **authoritative** |
| PHASE8_STEP1_15_LAYER_DNA_SPECIFICATION.md | As-built audit snapshot |
| PHASE9_MIGRATION_IMPLEMENTATION_BLUEPRINT.md | How to reach EDS from current code |
| Prior phase audits | Historical evidence |

**After EDS sign-off:** No further planning documents required. Changes to DNA behaviour require **EDS revision** with version bump.

---

# APPENDIX B — Glossary

| Term | Definition |
|------|------------|
| **DNA Package** | Immutable sealed record of 15 modules + header |
| **Probe** | Investigation suspect upload |
| **SSoT** | Stored sealed DNA — never regenerated for identity |
| **Suite** | Versioned set of algorithms and comparison parameters |
| **SEALED** | Terminal storage_status; immutable |

---

**END OF ENTERPRISE DNA SPECIFICATION (EDS-1.0)**
