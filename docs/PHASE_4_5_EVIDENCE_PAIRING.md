# Phase 4.5 — Evidence Pairing & Deterministic Investigation

**Status:** Implemented  
**Constraint:** No threshold, Acceptance policy, Candidate Ranking, or UI changes.

---

## Layer classification

| Layer | Purpose | Group | Registration | Investigation | Comparable? |
|------|---------|-------|--------------|---------------|-------------|
| L1 Cryptographic | Byte identity | **Content** | sha256 stored | Ephemeral sha256 | **YES** (exact) |
| L2 Structural | Edge / structure | **Content** | edgeSignature64 | Regenerated | **YES** |
| L3 Perceptual | pHash | **Content** | pHash64 | Regenerated | **YES** |
| L4 Semantic | Color fingerprint | **Content** | colorFingerprint | Regenerated | **YES** |
| L5 Metadata | Stable EXIF subset | **Content** | Stable EXIF hash | Stable EXIF hash | **YES** |
| L6 Signature | Content-bound seal | **Content** | Was payloadHmac (record-bound) → now **COMPARE:** HMAC from L1–L5 | **COMPARE:** HMAC from L1–L5 | **YES** (aligned) |
| L7 Behavioral | Upload session | **Registry** | behaviorHash | Must not content-compare | **SKIPPED** until content verified |
| L8 Relationship | Graph | **Registry** | graphHash | — | **SKIPPED** until content verified |
| L9 Origin | Origin bundle | **Registry** | bundleHash | — | **SKIPPED** until content verified |
| L10 Evolution | Merkle / mutations | **Registry** | merkleRoot | — | **SKIPPED** until content verified |
| L11 Deepfake | Advanced | **Registry** | Optional on upload | Not on probe | **SKIPPED** (or PASS if content verified + vault has row) |
| L12 Watermark | Advanced | **Registry** | Optional | Not on probe | **SKIPPED** / registry confirm |
| L13 Custody | Advanced | **Registry** | Optional | Not on probe | **SKIPPED** / registry confirm |
| L14 ZK Proof | Advanced | **Registry** | Optional | Not on probe | **SKIPPED** / registry confirm |
| L15 Biometric | Advanced | **Registry** | Optional | Not on probe | **SKIPPED** / registry confirm |

---

## Fixes shipped

1. **L6 alignment** — `StoredDnaFingerprinter` uses the same `HMAC(COMPARE:fileType:L1–L5)` construction as `EphemeralFingerprinter.stabiliseL6`.
2. **L7–L15** — On vault investigation, never FAIL for missing/regenerated registry evidence; mark **SKIPPED**, then **PASS** only when content identity is verified (L1 exact or L3 ≥ 0.88) and vault has the registry row.
3. **PASS / FAIL / SKIPPED** — `LayerComparisonResult.skipped` maps to UI `status: skipped` (UI already supported it).
4. **Timeout retain** — `withTimeoutSoftRetain` keeps deep-DNA / enterprise recovery results that finish within a grace window after the soft deadline.

---

## Determinism expectations

Same probe should now:

- Compare equivalent L1–L6 constructions every run  
- Not randomly FAIL L7–L15  
- Not drop completed deep DNA that finishes a few seconds late  

Remaining non-determinism sources (out of scope for 4.5): decrypt failures for some vault IDs, vector ranking order under extreme noise. Those do not invent FAIL on registry layers.

---

## Success criteria mapping

| Criterion | How addressed |
|-----------|----------------|
| Same evidence both sides | L6 COMPARE: on vault + probe |
| Registry not regenerated as content | L7–L15 SKIPPED path |
| No FAIL for never-generated | skipped flag |
| Completed evidence reaches Acceptance | withTimeoutSoftRetain + enterprise retainGraceMs |
