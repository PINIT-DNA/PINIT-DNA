# Acceptance Rules

**Policy version:** `acceptance-policy-v1.0`  
**Status:** Frozen — do not change without bumping policy version and documenting migration.

Only the **Acceptance Engine** applies these rules. No other module may emit a final verdict.

---

## Five verdicts

| Verdict | Code | Meaning |
|---------|------|---------|
| VERIFIED ORIGINAL | `VERIFIED_ORIGINAL` | Original PINIT asset |
| VERIFIED DERIVATIVE | `VERIFIED_DERIVATIVE` | Same asset, modified |
| POSSIBLE MATCH | `POSSIBLE_MATCH` | Needs analyst review |
| NOT PINIT | `NOT_PINIT` | No supporting evidence |
| INSUFFICIENT EVIDENCE | `INSUFFICIENT_EVIDENCE` | Investigation could not complete |

---

## VERIFIED ORIGINAL

**Requirements (all must PASS):**

| Gate | Rule |
|------|------|
| DNA | PASS (full / high; not DIFFERENT) |
| Certificate | PASS (valid, active, bound to vault + DNA) |
| Vault | PASS (authoritative vault locked) |
| Owner | PASS (owner binds to vault) |
| Timeline | PASS (registration / custody consistent) |
| Confidence | **> 95%** (scorecard only) |

**UI label:** `VERIFIED PINIT ASSET`  

**Forbidden labels:** “Signature Found” as a substitute for this tier.

---

## VERIFIED DERIVATIVE

Use when the **original is identified** but the probe is altered (crop, WhatsApp, resize, screenshot, re-encode, etc.).

**Requirements:**

| Gate | Rule |
|------|------|
| DNA | PARTIAL (derivative band; not full original) |
| Visual | PASS (ORB / patch / keyframe within band) |
| Timeline | PASS |
| Owner | PASS |
| Tamper | DETECTED (at least one tamper vector) |

**UI must show:**

- Original found (vault / DNA / owner)
- Derivative detected
- Tampering list
- Owner verified

Not “maybe” and not “full original.”

---

## POSSIBLE MATCH

**Requirements:**

| Gate | Rule |
|------|------|
| Visual | Strong (e.g. ≥ 80%) |
| DNA | Weak/partial (e.g. ≥ 40% and below verified bands) |
| Certificate | None or FAIL |
| Watermark | None or FAIL |

**UI label:** `Possible PINIT Asset — Needs Manual Review`

**Forbidden:** `Signature Found`, `Verified`, green verified styling.

---

## NOT PINIT

**Requirements:**

| Gate | Rule |
|------|------|
| DNA | FAIL or missing (analysis completed) |
| Certificate | FAIL or missing |
| Timeline | No custody link |
| Similarity | Low **or** high but rejected by DNA/ORB/fusion gates |

**UI label:** `No PINIT Asset Found`

On this path: **retrieval confidence = 0**. No owner/vault block from a rejected candidate.

---

## INSUFFICIENT EVIDENCE

Use when the system **could not complete analysis**, not when analysis completed and found no match.

**Examples:**

- Corrupted file
- Encrypted ZIP (cannot open)
- Unsupported codec
- Damaged PDF
- Partial download
- Scanner blur below quality gate
- FFmpeg unavailable (video path blocked)
- OCR crashed (document path blocked)
- Stage timeout with no usable evidence

**UI label:** `Insufficient Evidence — Investigation Incomplete`

**Must not** be labeled `NOT_PINIT` (that implies “we analyzed and it is not ours”).

Manifest must include `failureReason` and which stage failed.

---

## Hard invariants (bug-proof)

These make “Similarity 94% + DNA 18% → Signature Found” **impossible**:

1. DNA DIFFERENT or DNA below acceptance band ⇒ cannot be VERIFIED ORIGINAL or VERIFIED DERIVATIVE.
2. Retrieval / fusion alone never upgrades verdict.
3. POSSIBLE never uses “Signature Found.”
4. Rejected candidate ⇒ drop that vault; try next; if none pass and analysis completed ⇒ NOT PINIT.
5. If analysis did not complete ⇒ INSUFFICIENT EVIDENCE, not NOT PINIT.
6. Video/PDF adapters only change evidence collection, not these rules.
7. Confidence is a weighted scorecard; failed channels contribute 0.

---

## Candidate walk (acceptance input)

```text
Candidates ranked
→ For each candidate #1 … #N:
     Collect evidence (DNA, visual, cert, …)
     Run gates
     If ACCEPT → stop, emit verdict
     If REJECT → next candidate (do not keep retrieval %)
→ If all rejected and analysis complete → NOT_PINIT
→ If analysis incomplete → INSUFFICIENT_EVIDENCE
```

---

## Policy versioning

Every manifest and report stores:

```json
"acceptancePolicyVersion": "acceptance-policy-v1.0"
```

Threshold changes require `v1.1` / `v2.0` and must not rewrite historical reports’ meaning without re-running under the new policy.
