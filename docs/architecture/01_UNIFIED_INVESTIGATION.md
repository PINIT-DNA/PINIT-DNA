# PINIT Unified Investigation — Core Architecture

**Status:** Frozen contract (v3)  
**Scope:** Single investigation engine inside Unified Investigation. No second product.

## Core principle

> **One Investigation Engine. Multiple Media Adapters. One Evidence Model.**

Everything enters the same orchestrator:

```text
Upload | Scanner | Crawler | API | Browser Extension | Mobile App
                              │
                              ▼
                 Unified Investigation Engine
                              │
                              ▼
              Media Adapter (Image | Video | PDF | Audio | Office | Archive)
                              │
                              ▼
                      Candidate Search
                              │
                              ▼
                    Evidence Verification
                              │
                              ▼
                      Acceptance Engine   ← only place that decides
                              │
                              ▼
                       Evidence Report
```

## Pipeline (immutable order)

```text
Probe in
→ Identify media type (adapter)
→ Generate probe DNA
→ Search vault (vector + identity + local DNA)
→ Rank candidates
→ Deep compare (walk #1…#N)
→ Evidence verification (cert, watermark, timeline, owner)
→ Tamper analysis
→ Confidence scorecard
→ Acceptance Engine (verdict)
→ Investigation Manifest
→ Report (UI / PDF / API / audit — all read manifest)
```

## Evidence vs decision

| Module | Returns | Must not |
|--------|---------|----------|
| ORB / visual | scores | verdict |
| DNA compare | scores, classification | verdict |
| Certificate | valid / invalid / skipped | verdict |
| Timeline | events, owner bind | verdict |
| Watermark | recovered / not / skipped | verdict |
| Fusion / scorecard | channel scores | final label alone |
| **Acceptance Engine** | **verdict + confidence** | — |

Similarity and retrieval are **evidence only**. They never set the verdict by themselves.

## Hard invariants

1. DNA DIFFERENT or DNA below acceptance band ⇒ cannot be VERIFIED ORIGINAL or VERIFIED DERIVATIVE.
2. Retrieval / fusion alone never upgrades verdict.
3. POSSIBLE never uses “Signature Found” or green verified styling.
4. Rejected candidate ⇒ drop vault; try next; if none pass ⇒ NOT PINIT (or INSUFFICIENT EVIDENCE if analysis failed).
5. Media adapters only change how evidence is **collected**, not acceptance rules.
6. Failed scorecard channels contribute **0** weight.
7. Every output (UI, PDF, API, audit) reads the **Investigation Manifest**.

## Related contracts

| Doc | Topic |
|-----|--------|
| [02_ACCEPTANCE_RULES.md](./02_ACCEPTANCE_RULES.md) | Five verdicts and gates |
| [03_DNA_SPECIFICATION.md](./03_DNA_SPECIFICATION.md) | Layer schema + DNA version |
| [04_CONFIDENCE_SCORECARD.md](./04_CONFIDENCE_SCORECARD.md) | Deterministic confidence |
| [05_EVIDENCE_GRAPH.md](./05_EVIDENCE_GRAPH.md) | Custody graph and trail |
| [06_TAMPER_MATRIX.md](./06_TAMPER_MATRIX.md) | Tamper flags |
| [07_MEDIA_ADAPTERS.md](./07_MEDIA_ADAPTERS.md) | Per-media collection only |
| [08_GOLDEN_DATASET.md](./08_GOLDEN_DATASET.md) | Benchmark assets |
| [09_REGRESSION_TESTS.md](./09_REGRESSION_TESTS.md) | Merge gates |
| [10_INVESTIGATION_REPORT_SPEC.md](./10_INVESTIGATION_REPORT_SPEC.md) | Report + manifest |

## Enterprise objective

Given any supported file, PINIT must deterministically answer:

- Is it a PINIT asset?
- Who owns it?
- Which Vault ID, DNA ID, and Certificate ID?
- Original or derivative?
- What modifications were made?
- Complete chain of custody?
- What evidence supports the conclusion?
- How confident is the system, and why?

This is ownership verification and forensic custody—not duplicate detection alone.
