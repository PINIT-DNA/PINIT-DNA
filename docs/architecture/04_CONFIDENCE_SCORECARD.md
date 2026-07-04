# Confidence Scorecard

**Status:** Frozen weights for `acceptance-policy-v1.0`  
**Rule:** Never random fusion. Never hidden boosts.

## Principle

Confidence is a **weighted sum of accepted evidence channels**.  
If a channel **FAIL**s or is **SKIPPED**, its contribution is **0**.

```text
Final confidence = Σ (weight_i × score_i)  for channels that PASS
```

Scores are 0–100 per channel. Weights sum to 100%.

## Weights (`acceptance-policy-v1.0`)

| Channel | Weight |
|---------|--------|
| Certificate | 25% |
| DNA | 30% |
| Visual | 15% |
| Metadata | 10% |
| Watermark | 10% |
| Timeline | 5% |
| Owner | 5% |
| **Total** | **100%** |

## Channel rules

| Channel | PASS contributes | FAIL / SKIPPED |
|---------|------------------|----------------|
| Certificate | validity score (typically 100 if valid) | 0 |
| DNA | overall DNA compare % | 0 if DIFFERENT or below gate |
| Visual | ORB / patch / keyframe score | 0 |
| Metadata | consistency score | 0 |
| Watermark | recovery confidence | 0 |
| Timeline | custody consistency | 0 |
| Owner | bind confidence | 0 |

**If DNA fails:** DNA weight contribution = **0**. No retrieval-only substitute.

## Tamper

Tamper does **not** invent identity. It:

- Is reported in the tamper matrix
- May **block VERIFIED ORIGINAL** (force DERIVATIVE or lower)
- May apply a documented penalty only if policy version defines one (v1.0: no silent penalty; use verdict tier instead)

## Display

Every report must show:

```text
Certificate   25% × score → contribution
DNA           30% × score → contribution
Visual        15% × …
…
Final         XX.X%
```

Analysts must see **why**, not a single opaque number.

## Verdict thresholds (use with acceptance rules)

| Verdict | Confidence (typical) |
|---------|----------------------|
| VERIFIED ORIGINAL | > 95% **and** all gates PASS |
| VERIFIED DERIVATIVE | High but DNA partial + tamper DETECTED |
| POSSIBLE MATCH | Moderate; cert/watermark missing |
| NOT PINIT | Low or zero after completed analysis |
| INSUFFICIENT EVIDENCE | Confidence may be N/A; analysis incomplete |

Confidence alone never overrides acceptance gates.
