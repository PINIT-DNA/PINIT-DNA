# PINIT-DNA Phase 8 — Step 1

## Complete 15-Layer DNA Specification (Current Implementation)

**Mode:** Read-only architecture analysis  
**Date:** 2026-07-16  
**No code modified. No database changed.** (Specification document only.)

**Policy context from codebase:**

- Image path: `POST /api/v1/dna/generate` → `dna.controller.generateDna` → `UniversalFileRouter.route` → `DnaOrchestrator.generate`
- Non-image: type-specific `*DnaEngine` → L1–L6 in `dna_records.universalFingerprints` JSON; L7–L15 via `processAdvancedLayers` when `ownerUserId` present
- Compare: `DnaComparisonService` → `StoredDnaFingerprinter` / `EphemeralFingerprinter` → `ComparisonEngine`
- Weights in compare: L1–L6 only; L7–L15 weight **0**

---

# LAYER 1 — Cryptographic

### 1. Layer Name

**Cryptographic** (`cryptographic` / registry: `sha256_serialized`)

### 2. Purpose

Prove **exact file / pixel identity**. Detect any byte or pixel change. Used as the strongest identity signal (exact original).

### 3. Current algorithm (image)

1. `sha256Hash = SHA-256(file_bytes)` → hex
2. Decode with sharp → RGB raw pixels (alpha removed)
3. `normalizedHash = SHA-256(pixel_bytes)` → hex
4. Optional `blake3Hash` via enhancement helper

**Non-image (e.g. PDF):** `SHA-256(file_bytes)`; often also `SHA-256(normalized_text)`.

**Math:** Cryptographic hash; avalanche — 1-bit change → unrelated digest.

### 4. Input

Raw upload `Buffer`. Image: decoded RGB raster for normalized hash.

### 5. Output

| Field | Format |
|-------|--------|
| Primary compare FP | `sha256Hash` — 64 hex chars (`Char(64)`) |
| Also stored | `normalizedHash` 64 hex; `blake3Hash` optional 64 hex |

### 6. Storage

| | |
|--|--|
| Table | `crypto_layers` (`CryptoLayer`) |
| Columns | `sha256Hash`, `normalizedHash`, `blake3Hash?` |
| Also | `dna_records.sha256Hash` |
| Non-image | L1 also in `universalFingerprints.layers[]` |
| Indexed | No dedicated index on `crypto_layers.sha256Hash`; hub field often queried on `dna_records` |
| Nullable | hashes required on success; blake3 optional |

### 7. Generation

- Class: `CryptographicLayer.generate` (`layer1.cryptographic.ts`)
- Orchestrator: `DnaOrchestrator`
- Engines: PDF/TXT/… `layer1` methods
- Route: `POST /dna/generate`

### 8. Comparison

- Service: `ComparisonEngine.scoreLayer(1)`
- Algorithm: **binary** string equality on fingerprint (`sha256Hash`)
- Threshold: **1.00** for `matched`
- Weight: **0.35**

### 9. Acceptance / investigation usage

| Area | Used? |
|------|-------|
| Ownership | Indirect — high DNA score / SHA exact path |
| Confidence | Yes — 35% of DNA compare → DNA channel (30% of acceptance) |
| Retrieval | **Yes** — exact SHA vault match |
| Ranking | Yes — cryptographic signal / exact path |
| Investigation | Yes — identity hit tier 1 |

`StoredDnaFingerprinter` maps L1 ← `cryptoLayer.sha256Hash`.

### 10. Determinism

**YES** for same bytes + same sharp pipeline (sha256 + normalizedHash).  
blake3 depends on enhancement helper. Cross-libvips versions: **PARTIAL** risk on normalizedHash.

### 11. Weaknesses

- Compare uses **file** hash, not `normalizedHash` → re-encode = L1 fail even if pixels identical
- No DB index on hash columns in layer table
- Non-image vs image semantics differ under same layer number

### 12. Enterprise recommendation

Treat **content hash** (normalized/canonical) and **bitstream hash** as separate versioned fields; compare policy chooses which; content-addressed immutable store; indexes for O(1) exact lookup.

---

# LAYER 2 — Structural

### 1. Layer Name

**Structural** (`sobel_edge_detection`; schema default algorithm string `"canny"` — **code uses Sobel**)

### 2. Purpose

Prove **spatial / edge organisation** identity (layout of boundaries). Survives mild colour/brightness change; weak under heavy crop.

### 3. Current algorithm (image)

1. RGB → grayscale `Y = 0.299R + 0.587G + 0.114B`
2. Sobel Gx/Gy; magnitude `√(gx²+gy²)`; threshold **30**
3. 8×8 zones; edge density per zone
4. Bit = 1 if density > **global mean** → 64 bits → **16 hex** `edgeSignature64`
5. Also stores edge map B64 + edgeVectors JSON; optionally embeds bits in red LSB carrier

**Non-image:** type-specific (e.g. PDF page layout hash, CSV schema fingerprint).

### 4. Input

Decoded RGB pixels (image) or structure of document/bytes (non-image).

### 5. Output

- Compare FP: `edgeSignature64` — **16 hex** (64-bit)
- Also: `edgeMapB64` (String), `edgeVectors` (Json), `algorithm` String

### 6. Storage

`structural_layers`: `edgeSignature64 Char(16)`, `edgeMapB64`, `edgeVectors`, `algorithm`  
Non-image: `universalFingerprints`  
Indexed: no on signature  
1:1 `dnaRecordId @unique`

### 7. Generation

`StructuralLayer.generate(image, dnaRecordId)` → `DnaOrchestrator` / engines

### 8. Comparison

`hexSimilarity` / Hamming on hex — **continuous** 0–1  
Threshold: **0.80** · Weight: **0.20**

### 9. Acceptance / investigation

| | |
|--|--|
| Ownership | Indirect via DNA score |
| Confidence | Yes (20% of DNA) |
| Retrieval / ranking | **Yes** — structural score in vault similarity vector |
| Investigation | Yes |

Note: layer `verify()` may differ from ComparisonEngine hex path.

### 10. Determinism

**YES** for same decode + same dimensions (mean-threshold is deterministic).  
**PARTIAL** if sharp decode differs; carrier LSB path is side-effect, not compare FP.

### 11. Weaknesses

- Schema says `canny`, code Sobel
- Global mean threshold sensitive to content scale
- 64-bit signature collision risk at vault scale
- Heavy crop destroys signature

### 12. Enterprise recommendation

Multi-scale structural sketches + LSH index; separate embeddable carrier from immutable signature; version algorithm id on row.

---

# LAYER 3 — Perceptual

### 1. Layer Name

**Perceptual** (`dct_phash`)

### 2. Purpose

Prove **visual similarity** under compression/resize. Primary crop/near-duplicate content signal.

### 3. Current algorithm

- **pHash64:** resize 32×32 gray → DCT → top-left 8×8 → mean threshold → 64 bits → 16 hex
- **pHash256:** extended 16×16 coeffs → 64 hex
- **aHash64:** 8×8 average hash
- **dHash64:** 9×8 difference hash

Layer `verify`: weighted blend pHash 60% + aHash 20% + dHash 20% (Hamming).  
Match thresholds in class: ~10/64 bits etc.

**Non-image:** often SimHash of text/content.

### 4. Input

Image buffer via sharp resize; or text bytes for non-image.

### 5. Output

Compare FP (stored path): **`pHash64`** — 16 hex  
Also stored: `pHash256` Char(64), `aHash64`, `dHash64` Char(16)

### 6. Storage

`perceptual_layers` — all four hashes; no secondary indexes on pHash in Prisma schema  
Non-image: JSON layers

### 7. Generation

`PerceptualLayer.generate` / `computeFingerprints` (also used live in ranking)

### 8. Comparison

`hammingSimilarity` on fingerprint string — **continuous**  
Threshold: **0.75** · Weight: **0.20**  
Vault unlock for L7–L15 credit: L3 ≥ **0.88**

### 9. Acceptance / investigation

| | |
|--|--|
| Ownership | Via DNA + visual channels; L3 gates in ranking (55/70) |
| Confidence | Yes |
| Retrieval / ranking | **Primary** visual signal |
| Investigation | **Critical** |

### 10. Determinism

**YES** for same sharp resize/DCT implementation. Cross-version: **PARTIAL**.

### 11. Weaknesses

- Full-frame pHash weak on small crops (mitigated by Local DNA patches, not this layer)
- Compare uses only pHash64 string, not full weighted verify
- No ANN/LSH on `pHash64` in DB schema

### 12. Enterprise recommendation

Store multi-resolution pHash; Hamming LSH / bucket index; patch-level pHash already parallel — unify versioning with L3.

---

# LAYER 4 — Semantic

### 1. Layer Name

**Semantic** (`rgb_hsv_histogram`) — for images = **colour distribution**, not NLP semantics

### 2. Purpose

Prove **colour / distribution personality** (warm/cool, palette). Secondary visual discriminator.

### 3. Current algorithm (image)

256-bin RGB histograms; 8-bin compress; HSV H/S histograms; dominant colours;  
`colorFingerprint` = 3× channelFingerprint → **12 hex chars**

Layer `verify`: histogram intersection (not used by ComparisonEngine).  
**ComparisonEngine:** `hexSimilarity` on `colorFingerprint`.

**Non-image:** keywords / topic / top-words hashes.

### 4. Input

Raw RGB pixels (or extracted text for docs).

### 5. Output

FP: `colorFingerprint` Char(12)  
Also Json: histogramR/G/B/H/S, dominantColors

### 6. Storage

`semantic_layers`  
Non-image: `universalFingerprints`

### 7. Generation

`SemanticLayer.generate` → orchestrator / engines

### 8. Comparison

Continuous hex/Hamming · Threshold **0.70** · Weight **0.10**

### 9. Acceptance / investigation

Retrieval vector **semanticColor**; DNA weight 10%; acceptance via DNA channel only (not separate “semantic” acceptance channel).

### 10. Determinism

**YES** for same pixels.

### 11. Weaknesses

- Name “semantic” vs colour histogram mismatch
- Engine compare ≠ layer.verify intersection
- Lookalike risk (same palette, different content)
- Short 12-hex FP

### 12. Enterprise recommendation

Rename/clarify; store embedding vector for true semantics; keep colour as separate channel with intersection compare.

---

# LAYER 5 — Metadata

### 1. Layer Name

**Metadata** (`exif_metadata_stable` in compare path)

### 2. Purpose

Prove **provenance / EXIF device & capture context** (C2PA-style intent). Easily stripped.

### 3. Current algorithm

1. Parse EXIF/IPTC/XMP (`exifr`)
2. Build provenance manifest (tool, version, dnaRecordId, layer1HashRef, generatedAt)
3. `metadataHash = SHA-256(JSON({exif sorted, dnaRecordId, layer1HashRef, tool, version}))`

**Compare FP (not metadataHash):**  
`SHA-256(JSON({deviceMake, deviceModel, capturedAt ISO, gpsLat, gpsLon}))`

### 4. Input

File metadata blocks + dnaRecordId + L1 hash ref.

### 5. Output

Stored: `metadataHash` Char(64) + EXIF fields  
Compare: 64-hex **stable EXIF** digest

### 6. Storage

`metadata_layers` — exifData Json?, device*, capturedAt?, gps*, iptc/xmp Json?, metadataHash  
Non-image: engine-specific metadata FP in JSON

### 7. Generation

`MetadataLayer.generate(image, dnaRecordId, layer1Hash)` after L1 in orchestrator

### 8. Comparison

**Binary** equality of stable fingerprint · Threshold **0.60** · Weight **0.05**

### 9. Acceptance / investigation

- DNA score: minor (5%)
- Acceptance **metadata channel** today is often **structural proxy**, not this layer
- Ranking: weak / not primary

### 10. Determinism

**PARTIAL** — EXIF fields stable, but **`metadataHash` includes `dnaRecordId`** → new upload ≠ same hash. Stable compare FP: **YES** if EXIF unchanged.

### 11. Weaknesses

- Stored hash ≠ compared hash
- dnaRecordId in stored hash
- Social apps strip EXIF
- Acceptance “metadata” miswired to structural

### 12. Enterprise recommendation

Persist compare-stable EXIF digest at generation; never bind identity hash to record UUID; C2PA claim store separate from content DNA.

---

# LAYER 6 — Signature (Steganography / HMAC)

### 1. Layer Name

**Signature** (`lsb_steganography_hmac` / compare: `…_compare_stable`)

### 2. Purpose

Prove **integrity seal** / embedded signature. Intent: detect seal break.

### 3. Current algorithm (image generate)

1. `token = randomBytes`
2. `payloadHmac = HMAC-SHA256(secret, token)`
3. Embed magic+token+hmac in **blue LSB** carrier PNG

**Compare (both stored & ephemeral):**  
`HMAC-SHA256(secret, "COMPARE:{fileType}:{L1}|{L2}|{L3}|{L4}|{L5}")`  
**Ignores** stored `payloadHmac`.

**Non-image generate:** often `HMAC(fileType:dnaRecordId:L1-L5)` — record-bound.

### 4. Input

Generate: image pixels + secret. Compare: L1–L5 fingerprint strings + fileType + secret.

### 5. Output

Stored: `payloadHmac` Char(64), embedded bool, capacity/used bits, channel `"B"`, carrierPath?  
Compare FP: 64-hex COMPARE HMAC

### 6. Storage

`stego_layers`  
Non-image: JSON layer 6 fingerprint

### 7. Generation

`SteganographyLayer.generate` after L5; engines `layer6`

### 8. Comparison

**Binary** · Threshold **0.90** · Weight **0.10**

### 9. Acceptance / investigation

Affects DNA overall score only; not a separate acceptance channel. Live regenerate re-runs embed then stabilises.

### 10. Determinism

**NO** for stored `payloadHmac` (random token).  
**YES** for COMPARE HMAC given identical L1–L5.

### 11. Weaknesses

- Random seal vs comparable seal split
- Record-ID-bound non-image L6
- Carrier on local disk (ephemeral hosts)
- Weight 10% punishes all edits (HMAC flips)

### 12. Enterprise recommendation

Two artifacts: (A) immutable content-seal HMAC over L1–L5 at generation; (B) optional unique embed token for tracing — never conflate in compare.

---

# LAYER 7 — Behavioral

### 1. Layer Name

**Behavioral** (`sha256_behavior_bundle`)

### 2. Purpose

Bind DNA to **upload session behaviour** (timing, UA, session) — not file content.

### 3. Current algorithm

`behaviorHash = SHA-256(JSON({dnaRecordId, filename, size, mime, uploadMs, userAgent, sessionToken, ts}))`

### 4. Input

Request context + file meta + clocks — **not pixels**.

### 5. Output

`behaviorHash` hex String; `uploadMs` Int; hashed session; userAgent

### 6. Storage

`behavioral_layers`  
Also created for non-image advanced path when owner present

### 7. Generation

`BehavioralLayer.generate` in `DnaOrchestrator` (L7–10 parallel)

### 8. Comparison

Weight **0**; vault mode SKIPPED / content-credit PASS; else exact match if both exist · Threshold 0.50 if scored

### 9. Acceptance / investigation

**No** ownership/confidence/retrieval/ranking contribution (weight 0). Informational / registry credit only.

### 10. Determinism

**NO** — time, uploadMs, session, dnaRecordId.

### 11. Weaknesses

All session dependence; not forensic content identity; name implies behaviour analytics but is a static hash bundle.

### 12. Enterprise recommendation

Move to append-only **provenance events**, not DNA identity layers.

---

# LAYER 8 — Relationship

### 1. Layer Name

**Relationship** (`sha256_graph_hash`)

### 2. Purpose

Link DNA to **other records with same SHA** (duplicate graph).

### 3. Current algorithm

Query up to 10 other `dnaRecord` with same `sha256Hash`;  
`graphHash = SHA-256(sorted relatedIds)` or `SHA-256("isolated:"+dnaRecordId)`

### 4. Input

DB state + sha256Hash + dnaRecordId

### 5. Output

`graphHash` String?; `relatedIds` String[]; `relationTypes` String[]

### 6. Storage

`relationship_layers`

### 7. Generation

`RelationshipLayer.generate`

### 8. Comparison

Weight **0**; skip/credit pattern

### 9. Acceptance / investigation

Not used in score/ranking. Graph is snapshot-at-generate only.

### 10. Determinism

**NO** — depends on which duplicates exist at generate time and new uuid isolation key.

### 11. Weaknesses

Stale graph; isolated hash bound to record id; not updated when new duplicates appear.

### 12. Enterprise recommendation

External graph DB / provenance edges; DNA stores only content identity.

---

# LAYER 9 — Origin

### 1. Layer Name

**Origin** (`sha256_origin_bundle`)

### 2. Purpose

Record **upload origin** (IP, geo, UA, time) for custody narrative.

### 3. Current algorithm

`bundleHash = SHA-256(JSON({dnaRecordId, ip, UA, country, city, filename, mime, size, timestamp}))`

### 4. Input

HTTP/geo context + file meta

### 5. Output

`originBundle` Json; `bundleHash` String

### 6. Storage

`origin_layers`

### 7. Generation

`OriginLayer.generate`

### 8. Comparison

Weight **0**

### 9. Acceptance / investigation

Not in DNA score. Timeline/acceptance custody is separate (dnaRecordId presence).

### 10. Determinism

**NO**

### 11. Weaknesses

Time/IP in identity layer; PII in DNA table; not comparable across uploads of same file.

### 12. Enterprise recommendation

Provenance event stream only; hash chain of custody events outside DNA.

---

# LAYER 10 — Evolution

### 1. Layer Name

**Evolution** (`markov_mutation_log` / merkle)

### 2. Purpose

Version lineage from origin hash via **Merkle root** of mutation log.

### 3. Current algorithm

Single ORIGIN entry `{version:1, hash:sha256, ts:now, type:ORIGIN}`;  
leaf = SHA-256(JSON(entry)); merkle tree pairwise SHA-256; store `merkleRoot`, `mutationLog`, `version`

### 4. Input

L1 sha256Hash + timestamp

### 5. Output

`merkleRoot` String?; `mutationLog` Json; `version` Int

### 6. Storage

`evolution_layers`

### 7. Generation

`EvolutionLayer.generate`

### 8. Comparison

Weight **0**; threshold 1.00 if ever scored

### 9. Acceptance / investigation

Unused in scoring

### 10. Determinism

**PARTIAL/NO** — sha256 leaf content stable, but **ts in entry** → merkle changes every generate

### 11. Weaknesses

Not a real evolution history (always version 1 at generate); timestamp in leaf; unused in compare

### 12. Enterprise recommendation

Append-only mutation log with content-only leaves; merkle without wall-clock; link derived assets explicitly.

---

# LAYER 11 — Deepfake Detection

### 1. Layer Name

**Deepfake Detection** (`ai_deepfake_analysis`)

### 2. Purpose

Flag **AI-generated / manipulated** media via heuristic scores.

### 3. Current algorithm

Heuristics on raw buffer: adjacent-byte noise avg; JPEG DQT count; sampled channel stddev → average score 0–100; `isDeepfake` if > 70. **Not** a trained DNN in this path (python deepfake service exists separately; this layer is local heuristics).

### 4. Input

File buffer + mimeType

### 5. Output

Compare FP string of rounded `deepfakeScore`; DB: Float score, bools, modelVersion `"1.0"`, method, metadata Json

### 6. Storage

`deepfake_layers`  
Only if `processAdvancedLayers` with ownerUserId

### 7. Generation

`processLayer11` in `layers-11-15.service.ts` via `processAdvancedLayers` / orchestrator

### 8. Comparison

Weight **0**; skip unless both sides; vault credit if content verified

### 9. Acceptance / investigation

Not in acceptance weights; not in retrieval ranking DNA layers

### 10. Determinism

**PARTIAL** — same buffer → same heuristics; sampling step uses fixed step from length

### 11. Weaknesses

Not real deepfake ML; operates on compressed file bytes not pixels; unused in decisions; owner-gated

### 12. Enterprise recommendation

Versioned ML model with calibrated score; store model id; use as risk channel separate from identity DNA.

---

# LAYER 12 — Invisible Watermark

### 1. Layer Name

**Invisible Watermark** (`dct_frequency_watermark`)

### 2. Purpose

Bind **owner identity** into a watermark hash (stated DCT; implementation is hash of payload string).

### 3. Current algorithm

`watermarkHash = SHA-256(\`${ownerUserId}:${dnaRecordId}:${Date.now()}\`)`  
Stores method label `dct-frequency` / psychoacoustic / structural; strength constants; **no actual DCT embed into pixels in this function**.

### 4. Input

ownerUserId, dnaRecordId, clock — buffer unused for hash

### 5. Output

`watermarkHash` String; `ownerIdEncoded` (SHA256 owner slice); strength; embedded bool

### 6. Storage

`dct_watermark_layers`

### 7. Generation

`processLayer12`

### 8. Comparison

Weight **0**

### 9. Acceptance / investigation

**Separate** watermark/TEP/identity-token recovery paths feed acceptance **watermark** channel — often **not** this DB hash. Ranking/identity recovery use recovered marks from file bytes elsewhere.

### 10. Determinism

**NO** — Date.now() + dnaRecordId

### 11. Weaknesses

Claims DCT embedding but stores time-bound hash; not recoverable from pixels; disconnect from investigation watermark channel; owner-dependent

### 12. Enterprise recommendation

Real robust watermark with payload = vault/dna id; verify by extraction; DNA stores only algorithm version + payload id, not time nonce.

---

# LAYER 13 — Chain of Custody

### 1. Layer Name

**Chain of Custody** (`legal_custody_chain`)

### 2. Purpose

Court-oriented **custody snapshot** at registration.

### 3. Current algorithm

Build custody JSON entry (FILE_REGISTERED, timestamp, actor, fileHash, …);  
`evidenceHash` from chain content; store jurisdiction defaults

### 4. Input

buffer (for fileHash), ownerUserId, filename, clock

### 5. Output

`custodyChain` Json; `evidenceHash`?; `legalTimestamp`; flags dmcaReady/courtAdmissible

### 6. Storage

`custody_layers`

### 7. Generation

`processLayer13`

### 8. Comparison

Weight **0**; FP = evidenceHash or hash of chain

### 9. Acceptance / investigation

Acceptance **timeline** channel ≠ this layer (uses dnaRecordId presence). Forensic provenance events are separate append-only table.

### 10. Determinism

**NO** — timestamps

### 11. Weaknesses

Static snapshot not a live chain; duplicates provenance systems; unused in compare

### 12. Enterprise recommendation

Single append-only custody ledger; DNA holds pointer/merkle of chain head only.

---

# LAYER 14 — ZK Ownership Proof

### 1. Layer Name

**ZK Ownership Proof** (`hash_commitment_proof`)

### 2. Purpose

Prove ownership via **hash commitment** without revealing file (simplified scheme).

### 3. Current algorithm

`secret = randomBytes(32)`  
`commitmentHash = SHA-256(secret || fileHash || ownerUserId)`  
`publicKey = SHA-256(ownerUserId || dnaRecordId)`  
`proofData` = AES-256-GCM encrypt secret with key derived from ownerUserId, **IV all zeros**

### 4. Input

file buffer, ownerUserId, dnaRecordId

### 5. Output

commitmentHash, proofData, publicKey Strings; verified bool default true

### 6. Storage

`zk_proof_layers`

### 7. Generation

`processLayer14`

### 8. Comparison

Weight **0**; exact commitment if compared

### 9. Acceptance / investigation

Not wired into acceptance owner channel (owner uses cert/watermark fusion)

### 10. Determinism

**NO** — random secret

### 11. Weaknesses

Not a real ZK SNARK; zero IV; secret encrypted under owner-derived key; unused in verify path; non-deterministic commitment

### 12. Enterprise recommendation

Standard commitment/ZKP with deterministic derivation from HSM-backed owner key + content hash; verify API in acceptance.

---

# LAYER 15 — Biometric Bind

### 1. Layer Name

**Biometric Bind** (`biometric_hmac_bind`)

### 2. Purpose

Bind DNA to **uploader face embedding** (person, not just account).

### 3. Current algorithm

If no face: hash `"NOT_REGISTERED"`.  
Else: `SHA-256(embedding.map(v => v.toFixed(6)).join(','))` (+ further HMAC bind in remaining code)

### 4. Input

User.faceEmbedding from DB, ownerUserId

### 5. Output

`biometricHash`, type, bindMethod, userId, embeddedInFile bool

### 6. Storage

`biometric_bind_layers`

### 7. Generation

`processLayer15` — **no file bytes**

### 8. Comparison

Weight **0**

### 9. Acceptance / investigation

Not in fusion. Biometric auth is separate product path.

### 10. Determinism

**PARTIAL** — same embedding → same hash; float formatting fixed to 6 decimals; changes if embedding re-enrolled

### 11. Weaknesses

Owner-dependent; skipped without face; unused in investigation; privacy sensitivity of storing bind on DNA row

### 12. Enterprise recommendation

Store biometric bind in identity vault with consent; DNA stores only opaque bind id; never block content DNA on missing biometrics.

---

# Cross-cutting: Non-image & UniversalFingerprints

| Media | L1–L6 storage | L7–L15 |
|-------|---------------|--------|
| IMAGE | Dedicated Prisma tables | Tables if ownerUserId |
| PDF/DOCX/…/VIDEO/AUDIO | `dna_records.universalFingerprints.layers[]` (+ PDF may upsert crypto_layers) | Same advanced tables if owner |

JSON is **mutable** post-generate (enhancements, self-learning) — undermines immutability for non-image L1–L6.

---

# Comparison table

| Layer | Purpose | Algorithm | Storage | Comparison | Deterministic | Used in Investigation | Used in Acceptance | Needs Improvement |
|------:|---------|-----------|---------|------------|---------------|----------------------|--------------------|-------------------|
| 1 | Exact identity | SHA-256 (+ normalized) | `crypto_layers` + hub | Binary 35% | YES* | YES (SHA retrieval) | Via DNA 30% | High (normalize vs file hash) |
| 2 | Edge structure | Sobel 8×8 bit sig | `structural_layers` | Hamming 20% | YES* | YES (vector) | Via DNA | Med |
| 3 | Visual similarity | DCT pHash suite | `perceptual_layers` | Hamming 20% | YES* | YES (core) | Via DNA + L3 gates | High (indexing) |
| 4 | Colour / “semantic” | Hist → 12 hex | `semantic_layers` | Hex sim 10% | YES* | YES (vector) | Via DNA | Med |
| 5 | Provenance EXIF | EXIF + record-bound hash | `metadata_layers` | Binary stable 5% | PARTIAL | Weak | Misaligned channel | **Critical** |
| 6 | Integrity seal | Random LSB / COMPARE HMAC | `stego_layers` | Binary 10% | NO stored / YES compare | Via DNA only | Via DNA | **Critical** |
| 7 | Session behaviour | SHA of context | `behavioral_layers` | Weight 0 | NO | No (credit only) | No | High (move out) |
| 8 | Duplicate graph | SHA of related IDs | `relationship_layers` | Weight 0 | NO | No | No | High (move out) |
| 9 | Upload origin | SHA of geo/time | `origin_layers` | Weight 0 | NO | No | No | High (move out) |
| 10 | Version merkle | Merkle + ts leaf | `evolution_layers` | Weight 0 | NO | No | No | Med |
| 11 | Deepfake risk | Buffer heuristics | `deepfake_layers` | Weight 0 | PARTIAL | No | No | Med |
| 12 | Owner watermark | SHA(owner:id:time) | `dct_watermark_layers` | Weight 0 | NO | Indirect (other WM) | Watermark channel ≠ this | **Critical** |
| 13 | Custody snapshot | JSON + hash | `custody_layers` | Weight 0 | NO | No | Timeline ≠ this | Med |
| 14 | ZK commitment | Random secret commit | `zk_proof_layers` | Weight 0 | NO | No | No | High |
| 15 | Biometric bind | Face embed hash | `biometric_bind_layers` | Weight 0 | PARTIAL | No | No | Med |

\*Same decoder/environment assumed.

---

# Priority list (improve first)

| Rank | Layer | Why first |
|-----:|-------|-----------|
| 1 | **L6 Signature** | Stored vs compare split; randomness; breaks “same DNA” |
| 2 | **L5 Metadata** | Record-ID in hash; compare≠storage; acceptance wiring wrong |
| 3 | **L12 Watermark** | Non-deterministic; not real DCT; disconnect from investigation WM |
| 4 | **L1 Cryptographic** | Exact-match backbone; normalize vs bitstream policy |
| 5 | **L3 Perceptual** | Investigation backbone; needs scale indexing + version pin |
| 6 | **L7 Behavioral** | Not content DNA — separate for immutability goal |
| 7 | **L9 Origin** | Same — provenance not identity |
| 8 | **L8 Relationship** | Same — graph not identity |
| 9 | **L14 ZK Proof** | Random; unused; crypto hygiene |
| 10 | **L2 Structural** | Useful but secondary; schema/algorithm drift |
| 11 | **L4 Semantic** | Useful; naming/compare mismatch |
| 12 | **L10 Evolution** | Fix leaf determinism or relocate |
| 13 | **L13 Custody** | Consolidate with provenance events |
| 14 | **L11 Deepfake** | Risk channel; needs real model later |
| 15 | **L15 Biometric** | Optional bind; privacy; lowest for content DNA |

---

## Closing (Step 1 only)

Today’s codebase implements **six content-weighted layers (L1–L6)** plus **nine registry/provenance/protection layers (L7–L15)** that are largely **non-deterministic, non-comparable, and unused in acceptance scoring**. Enterprise goals (deterministic, permanent, versioned, immutable, comparable) are **not met** by L5–L15 as stored, and only partially by L1–L4.

**Related audits (conversation series):** DNA storage immutability, investigation retrieval, candidate retrieval, comparison engine, acceptance engine, deterministic behaviour.
