# PINIT-DNA Investigation Pipeline Audit

**Date:** 2026-07-04  
**Scope:** Evidence generation → storage → retrieval → probe → compare → acceptance  
**Constraint:** No threshold, acceptance, ranking, or UI changes in this audit.  
**Reference case (UI):** Vault `318f8de1-…`, DNA `57052ae2-…`, owner `PINIT-324BMMSL`  
**Layer UI:** L2/L3/L4/L5 VERIFIED (100% / 91% / 87% / 100%); L1 + L6–L15 FAILED at 0%

---

## Executive summary

| Finding | Severity | Stage |
|--------|----------|--------|
| Investigation compares **two different fingerprint pipelines** (vault registry vs ephemeral probe) | **Critical** | Deep Compare |
| **L6 is never comparable** (vault stores record-bound HMAC; probe uses `COMPARE:` stabilised HMAC; `scoreLayer` L6 is binary-only) | **Critical** | L6 Signature |
| **L7–L10 are session-bound** (upload-time behavior/origin/graph ≠ probe ephemeral session) | **High** | L7–L10 |
| **L11–L15 skipped on probe** (`EphemeralFingerprinter` / `DnaOrchestrator.generate` without `ownerUserId`) | **High** | L11–L15 |
| **Overall DNA weight** puts 45% on L1+L6, both expected 0% on any edit → overall collapses even when L2–L5 are strong | **High** | ComparisonEngine scoring |
| Soft timeouts discard completed DNA / local-patch results (race) | **High** | Stage executor |
| Live vector lead ≠ DNA-verified vault (wrong candidate can surface before DNA finishes) | **Medium** | Candidate search / SSE |
| Yesterday vs today is **not** primarily “DB corruption” — it is **evidence-path + timeout + acceptance-input** drift from recent pipeline changes | **Medium** | Release delta |

**Bottom line:** Content layers (L2–L5) that are stored and compared consistently **do work** (your screenshot proves identity on the correct owner/vault). Layers that fail are mostly **not apples-to-apples evidence**, not “missing 15-layer concept.” Acceptance cannot invent identity from L1/L6/L7–L15 when those channels are structurally incomparable.

---

## Pipeline map (as implemented)

```
Original File
      ↓
DnaOrchestrator.generate (ownerUserId present on upload)
      ↓
L1–L10 tables + L11–L15 (only if ownerUserId)
      ↓
Vault encrypt + Certificate + Timeline + Vectors / local-DNA index
      ↓
Investigation upload (probe)
      ↓
Enterprise recovery: vector search → (local DNA) → ranking → deep compare
      ↓
Deep compare:
  File A = StoredDnaFingerprinter.fromDnaRecord(vaultDnaRecordId)   ← registry
  File B = EphemeralFingerprinter.fingerprint(probe)              ← temp DNA, no ownerUserId
      ↓
ComparisonEngine.compare(fpA, fpB, { vaultCompare: true })
      ↓
Acceptance Engine (channels built from ranking / outcome)
      ↓
Report.layerAnalysis + Manifest
```

**Critical fork:** Vault side never re-fingerprints the original bytes for L1–L15 registry path; probe side **always regenerates** a temporary DNA record and deletes it.

---

## Step 1–4 — Layer-by-layer evidence audit

Legend: **Stored** = vault DNA registry · **Probe** = ephemeral investigation fingerprint · **Compared** = `ComparisonEngine`

### L1 Cryptographic

| | |
|--|--|
| **Generated (upload)** | `sha256(original bytes)` → `cryptoLayer.sha256Hash` |
| **Stored** | `CryptoLayer.sha256Hash` |
| **Retrieved** | `StoredDnaFingerprinter` → fingerprint = sha256Hash |
| **Probe** | Ephemeral `DnaOrchestrator.generate` → **new** sha256 of probe bytes |
| **Compared** | Exact string match only (`scoreLayer` L1 → 0 unless identical) |
| **UI** | 0% FAILED |

**Verdict:** **Correct FAIL for any edit/crop/WhatsApp re-encode.** Not a storage bug.  
**PASS/FAIL (identity of evidence):** PASS (consistent design) · **PASS/FAIL (useful for derivatives):** FAIL (always 0 on tamper)

---

### L2 Structural

| | |
|--|--|
| **Stored** | `structuralLayer.edgeSignature64` |
| **Probe** | Regenerated edge signature from probe pixels |
| **Compared** | Hex / Hamming similarity |
| **UI** | 100% VERIFIED |

**Verdict:** **Correct.** Same algorithm both sides; strong match on this case.  
**PASS**

---

### L3 Perceptual

| | |
|--|--|
| **Stored** | `perceptualLayer.pHash64` (+ aHash/dHash in data) |
| **Probe** | Regenerated pHash from probe |
| **Compared** | Hamming similarity |
| **UI** | 91% VERIFIED |

**Verdict:** **Correct.** Primary content identity signal for compress/crop.  
**PASS**

---

### L4 Semantic

| | |
|--|--|
| **Stored** | `semanticLayer.colorFingerprint` |
| **Probe** | Regenerated color fingerprint |
| **Compared** | Hex similarity |
| **UI** | 87% VERIFIED |

**Verdict:** **Correct.**  
**PASS**

---

### L5 Metadata

| | |
|--|--|
| **Generated (upload)** | EXIF fields; historical `metadataHash` included `dnaRecordId` (non-deterministic) |
| **Stored / Retrieved / Probe** | Both paths recompute **stable** fingerprint from `{deviceMake, deviceModel, capturedAt, gpsLat, gpsLon}` only |
| **Compared** | Exact match on stable fingerprint |
| **UI** | 100% VERIFIED |

**Verdict:** **Correct after stabilisation.** Empty EXIF on both sides → identical stable hash → 100%.  
**PASS** (note: 100% can mean “both empty,” not “rich EXIF matched”)

---

### L6 Signature — ROOT CAUSE (incomparable evidence)

| | |
|--|--|
| **Generated (upload)** | LSB stego HMAC bound to **dnaRecordId / embed token** → `stegoLayer.payloadHmac` |
| **Stored / Retrieved** | `payloadHmac` **as stored** (record-bound) |
| **Probe** | Ephemeral reads temp `payloadHmac`, then **`stabiliseL6` overwrites** with `HMAC("COMPARE:" + fileType + L1–L5)` |
| **Compared** | Requires identical fingerprints; else `scoreLayer` case 6 returns **0** |
| **UI** | 0% FAILED · Digital Signature **INVALID** |

**Verdict:** **Incorrect evidence pairing.**  
Vault L6 and probe L6 are **different constructions**. They will not match even for a byte-identical re-upload unless both sides use the same stabilisation (vault side does **not** call `stabiliseL6`).

```
Stored L6:   HMAC(record-bound embed / payloadHmac)
Probe L6:    HMAC(COMPARE:IMAGE:L1-L5)     ← ephemeral-fingerprinter.ts stabiliseL6
Compared:    always unequal → 0%
```

**PASS/FAIL:** **FAIL — evidence divergence at compare input, not DB corruption.**

---

### L7 Behavioral / L8 Relationship / L9 Origin / L10 Evolution

| | |
|--|--|
| **Stored** | Upload-session bundles (`behaviorHash`, `graphHash`, `bundleHash`, `merkleRoot`) |
| **Probe** | Ephemeral generates **new** L7–L10 for the investigation session (different IP/UA/time/graph) |
| **Compared** | Exact fingerprint match → almost always 0; **optional boost** if `vaultCompare && (L1 exact \|\| L3 ≥ 0.88)` forces L7–L10 to 100% |
| **UI (this case)** | All 0% FAILED despite L3 = 91% |

**Verdict:**  
- **By design**, L7–L10 are **not content DNA**; they are lifecycle/session registry.  
- Direct compare of upload session vs probe session is **expected FAIL**.  
- Code **intends** to credit them when content is verified (`comparison-engine.ts` `contentVerified`), but this report shows **0%** — so either boost did not run on the path that filled `layerAnalysis`, or an older/cached compare path was used. **This is an evidence-path inconsistency to fix later (not a threshold tune).**

**PASS/FAIL:** **FAIL — session fingerprints treated as if they were content layers.**

---

### L11–L15 Advanced protection

| | |
|--|--|
| **Upload** | `processAdvancedLayers` **only if `ownerUserId` set** |
| **Probe ephemeral** | `DnaOrchestrator.generate(image, { fileType, engineVersion })` — **no ownerUserId** → log: `Layers 11–15 skipped — no ownerUserId` |
| **Probe readImageLayers** | Does not include deepfake/watermark/custody/zk/biometric tables |
| **Vault retrieve** | May have L11–L15 if upload had owner |
| **Compared** | If only vault has L11–L15: special-case can mark 100%; if **neither** has success: **0%** |
| **UI** | All 0% FAILED · Watermark **DAMAGED** (separate identity-proof path) |

**Verdict:** Probe **never generates** L11–L15. If vault also lacks rows (partial DNA) or one-sided logic does not apply, UI shows total failure. Watermark “DAMAGED” comes from identity-proof / protection status, not from L12 fingerprint equality.

**PASS/FAIL:** **FAIL — probe pipeline systematically omits L11–L15.**

---

## Step 2 — Database storage checklist

| Field | Stored on upload? | Retrieved for investigate? | Same construction as probe? |
|-------|-------------------|----------------------------|-----------------------------|
| vault_id | Yes | Yes | N/A |
| dna_record_id | Yes | Yes (`vaultDnaRecordId`) | Probe uses **temp** id then deletes |
| certificate | Yes (if issued) | Yes | UI may show `-` if none active / not bound |
| owner_id | Yes | Yes | Yes |
| sha256 | Yes (L1) | Yes | Probe **different** if file changed |
| phash | Yes (L3) | Yes | Regenerated; comparable |
| orb / embeddings / vectors | Yes (separate indexes) | Candidate search only | Not part of 15-layer table compare |
| local DNA patches | Yes (if backfilled) | Local DNA stage | Comparable when stage finishes |
| watermark / L12 | Yes if L11–15 ran | Vault only | Probe missing |
| signature L6 | Yes payloadHmac | Vault payloadHmac | Probe **COMPARE:** HMAC — **DIFFERENT** |
| L7–L10 | Yes | Yes | Probe **new session** — **DIFFERENT** |

**No evidence of random DB overwrite in this audit.** Divergence is **construction mismatch**, not silent mutation of stored L2–L5.

---

## Step 3 — Investigation probe (what is actually built)

```
Probe SHA256     → ephemeral L1 (new bytes)
Probe pHash      → ephemeral L3
Probe ORB        → vector / local-DNA path (not L-table)
Probe embedding  → vector search (if enabled)
Probe metadata   → stable EXIF subset (L5)
Probe semantic   → L4 color fingerprint
Probe watermark  → not generated (no ownerUserId / L12)
Probe L6         → stabiliseL6(COMPARE:…)
Probe L7–L15     → L7–L10 session-only; L11–L15 absent
```

---

## Step 5 — Candidate ranking (why yesterday ≠ today)

Ranking itself is not “broken,” but **inputs are time- and race-dependent**:

1. **Fast vector lead** can point at a **wrong** vault (low composite ~25–35%) and emit SSE early.  
2. **Deep DNA** may still be running when **enterprise_recovery** soft-timeouts → Acceptance gets `analysisComplete: false` → `INSUFFICIENT_EVIDENCE`.  
3. **Per-candidate timeout** historically shorter than real compare (~21s) → completed DNA logged as `MISSING` / rejected.  
4. **Decrypt failures** (`VAULT_MASTER_SECRET` mismatch) → candidate returns null DNA → permanent reject for that vault.  
5. **Local patch DNA** can finish **after** the stage already returned (zombie work) → strong patch score never enters Acceptance.

So the same file can be:

| Outcome | Mechanism |
|---------|-----------|
| VERIFIED_DERIVATIVE | Deep DNA finished; L2–L5 strong; acceptance retained |
| INSUFFICIENT_EVIDENCE | Timeout before DNA; no invented DNA (post false-positive fix) |
| NOT_PINIT | All candidates DNA-rejected / decrypt-failed |
| Wrong vault (historical) | Live lead retained with **invented** DNA 40% (removed) |

---

## Step 6 — Acceptance Engine (why verdicts look “UNKNOWN”)

Acceptance only sees **channels**, not the 15-layer UI table directly:

| Channel | Typical derivative (your screenshot class) |
|---------|-----------------------------------------------|
| DNA | Pass only if ranking/deep score ≥ partial band |
| Visual | From vector / patch / deep |
| Certificate | Often SKIPPED / weak if not fully bound |
| Watermark | FAIL / damaged on modified protected files |
| Owner / Vault / Timeline | Pass when vault locked |

- **VERIFIED_ORIGINAL** — needs full DNA + cert + no tamper (L1 must effectively pass).  
- **VERIFIED_DERIVATIVE** — partial DNA + visual + tamperDetected (L1 fail is expected).  
- **POSSIBLE_MATCH** — weaker partial evidence.  
- **NOT_PINIT** — no candidate passed DNA gates.  
- **INSUFFICIENT_EVIDENCE** — `analysisComplete: false` (timeout / incomplete), **not** “layers unknown.”

UI “Risk: UNKNOWN” / “Tamper: UNKNOWN” on timeout paths is **incomplete analysis**, not Acceptance refusing to decide.

---

## Step 7 — Determinism

Same file **5×** is **not guaranteed** today:

| Source of non-determinism | Stage |
|---------------------------|--------|
| Soft timeout races (`withTimeoutSoft` discards late results) | enterprise_recovery / deep_compare / local_dna |
| Live SSE lead order (vector noise) | vault_search |
| Which candidates decrypt | deep_compare |
| Background work after stage return | local_dna / deep_compare zombies |
| Ephemeral temp DNA UUIDs (L6/L7–L10 session fields) | probe fingerprint |

```
NON DETERMINISTIC
Stage: enterprise_recovery + deep_compare (+ local_dna)
Reason: Promise.race timeouts drop completed evidence; session-bound layers differ every probe run
```

---

## Step 8 — Why yesterday looked better

| Yesterday | Today |
|-----------|--------|
| Longer budgets / weaker gates / **live snapshot invented DNA ≥ 40%** | Invented DNA removed (correct for false positives) |
| Timeout partial could show “Original Found — Derivative” on **wrong** vault | Timeout → INSUFFICIENT without DNA |
| Overall score still broken for derivatives (L1+L6 weight) | Same structural issue; intermittent success when L2–L5 alone carried ranking |

**Not explained by:** silent regeneration of stored L2–L5 for old vaults.  
**Explained by:** compare-input asymmetry (L6/L7–L15) + timeout races + acceptance no longer trusting unverified live leads.

---

## Step 9 — Audit scorecard

| Item | Status |
|------|--------|
| L2–L5 generate / store / retrieve / compare consistently | ✓ Correct |
| L1 fail on edited probe | ✓ Correct (expected) |
| Vault identity + owner on successful run | ✓ Correct (screenshot) |
| L6 vault vs probe fingerprint construction | ✓ Incorrect (diverged) |
| L7–L10 treated as content match | ✓ Incorrect (session vs session) |
| L11–L15 on probe | ✓ Missing |
| Overall score uses L1+L6 weight on derivatives | ✓ Incorrect for investigation semantics |
| Soft-timeout evidence retention | ✓ Incorrect (race) |
| Live lead without DNA | ✓ Changed (intentionally stricter) |
| Same file → same verdict always | ✓ Non deterministic |

---

## Root cause (single statement)

**Investigation does not compare “stored DNA” to “stored DNA.”** It compares **vault registry fingerprints** to a **fresh ephemeral DNA build** that (1) uses a different L6 formula, (2) omits L11–L15, (3) regenerates session L7–L10, and (4) feeds an overall score that permanently zeros 45% of weight on any non-byte-identical file. Timeouts then drop the content layers that *do* work. That is why the same original is sometimes identified (when L2–L5 finish in time) and sometimes UNKNOWN / NOT_PINIT (when the stage dies first)—not because the 15-layer model is missing.

---

## Recommended fix order (do not implement in this audit)

1. **Make L6 comparable:** apply the same `COMPARE:` stabilisation (or embed-extraction verify) on **vault** L6 in `StoredDnaFingerprinter`, or stop scoring L6 as content DNA in vault compares.  
2. **Stop scoring L7–L10 as content equality;** always treat as registry/SKIPPED unless contentVerified boost is applied consistently on every report path.  
3. **Generate or explicitly SKIP L11–L15 on probe** (never show FAIL when probe never ran the layer).  
4. **Remove timeout races:** await in-flight deep/local results or raise budgets only after (1)–(3); do not invent DNA.  
5. **Determinism test:** same probe 5× → same vaultId, dnaRecordId, verdict (gate CI).

Only after evidence inputs are aligned should Acceptance/ranking be revisited.

---

## Code references (audit anchors)

- Vault registry load: `src/services/verification/stored-dna-fingerprinter.service.ts`  
- Probe ephemeral + `stabiliseL6`: `src/services/verification/ephemeral-fingerprinter.ts`  
- Compare orchestration: `src/services/verification/dna-comparison.service.ts`  
- Layer scoring / L7–L10 boost / L11–L15 one-sided: `src/services/verification/comparison-engine.ts`  
- L11–L15 skip without owner: `src/services/dna.orchestrator.ts`  
- Authoritative compare: `src/services/forensics/authoritative-dna-compare.service.ts`  
- Report `layerAnalysis`: `src/services/forensics/unified-investigation.orchestrator.ts`
