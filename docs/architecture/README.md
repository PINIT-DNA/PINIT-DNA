# PINIT Architecture Contracts

These documents are the **core architecture specification** for Unified Investigation.  
Implementations must follow them. Threshold or schema changes require a **version bump** (DNA and/or acceptance policy), not silent edits.

## Documents

| # | File | Purpose |
|---|------|---------|
| 01 | [01_UNIFIED_INVESTIGATION.md](./01_UNIFIED_INVESTIGATION.md) | One engine, adapters, pipeline, invariants |
| 02 | [02_ACCEPTANCE_RULES.md](./02_ACCEPTANCE_RULES.md) | Five verdicts, gates, policy version |
| 03 | [03_DNA_SPECIFICATION.md](./03_DNA_SPECIFICATION.md) | 15-layer map, PASS/FAIL/SKIPPED, DNA version |
| 04 | [04_CONFIDENCE_SCORECARD.md](./04_CONFIDENCE_SCORECARD.md) | Deterministic weights, no hidden boost |
| 05 | [05_EVIDENCE_GRAPH.md](./05_EVIDENCE_GRAPH.md) | Custody graph, trail, ranking scale |
| 06 | [06_TAMPER_MATRIX.md](./06_TAMPER_MATRIX.md) | Tamper flags |
| 07 | [07_MEDIA_ADAPTERS.md](./07_MEDIA_ADAPTERS.md) | Evidence collection only |
| 08 | [08_GOLDEN_DATASET.md](./08_GOLDEN_DATASET.md) | Forensic benchmark |
| 09 | [09_REGRESSION_TESTS.md](./09_REGRESSION_TESTS.md) | Merge gates |
| 10 | [10_INVESTIGATION_REPORT_SPEC.md](./10_INVESTIGATION_REPORT_SPEC.md) | Manifest + report sections |

## Versions (current freeze)

| Artifact | Version |
|----------|---------|
| Acceptance policy | `acceptance-policy-v1.0` |
| DNA algorithm | `15-layer-v1` |

## Implementation order

1. Wire Acceptance Engine to five verdicts (no new features).
2. Scorecard confidence (failed channel = 0).
3. Manifest as single source for UI/API/PDF.
4. Tamper matrix + evidence trail on existing report.
5. Golden dataset + regression gates.

**Do not** add new AI features, screens, or dashboards until acceptance + golden metrics are stable.
