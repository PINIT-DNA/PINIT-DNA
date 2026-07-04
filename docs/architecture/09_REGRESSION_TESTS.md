# Regression Tests

**Status:** Merge policy for investigation engine changes.

## Principle

Only merge changes that **improve or maintain** golden-dataset metrics.  
Do not rely on manual “try one image” checks alone.

## Required checks

1. **Acceptance invariants**
   - DNA 18% + retrieval 94% must never yield VERIFIED or “Signature Found”
   - Unrelated probe → NOT_PINIT
   - Corrupt / unreadable probe → INSUFFICIENT_EVIDENCE

2. **Golden dataset suite** (see [08_GOLDEN_DATASET.md](./08_GOLDEN_DATASET.md))
   - Originals, derivatives, negatives
   - Per-media adapters

3. **Manifest consistency**
   - UI, API, and PDF fields match manifest verdict and confidence
   - `acceptancePolicyVersion` and `dnaAlgorithmVersion` present

4. **Candidate walk**
   - Rejected candidate does not leak owner/vault into final report
   - Retrieval confidence is 0 on NOT_PINIT after rejection

## Merge gate (policy)

| Condition | Action |
|-----------|--------|
| False positives increase | Block merge |
| Wrong vault / owner increases | Block merge |
| Original/derivative ID rate drops beyond tolerance | Block merge |
| Incomplete analysis mislabeled as NOT_PINIT | Block merge |
| Metrics stable or improved | Allow merge |

## Unit / contract tests (minimum)

- Acceptance Engine: each verdict given fixed evidence fixtures
- Scorecard: failed DNA → DNA contribution 0
- Layer states: PASS / FAIL / SKIPPED serialization

## CI recommendation

```text
PR → unit acceptance tests → golden subset (smoke) → full golden (nightly)
```

Full golden may be nightly if runtime is large; smoke subset must run on every PR that touches forensics.
