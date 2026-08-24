# Sentinel Benchmark Scorecard

Run started: 2026-08-20T03:16:46.751Z (COMPLETE)

## Totals

| Result | Count |
|---|---|
| PASS | 15 |
| PARTIAL | 11 |
| FALSE_NEGATIVE | 8 |

## A-transform

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-001 | Original unchanged | **PASS** | 102 | 99 | Very strong evidence (95-100%) |
| IMG-002 | 5% crop | **PARTIAL** | 90 | 98 | Strong evidence (85-94%) |
| IMG-004 | 25% crop | **PARTIAL** | 60 | 95 | Weak / requires investigation (50-69%) |
| IMG-006 | 75% crop (extreme) | **PARTIAL** | 55 | 80 | Weak / requires investigation (50-69%) |
| IMG-007 | 10% resize down | **PASS** | 99 | 98 | Very strong evidence (95-100%) |
| IMG-009 | 90% resize down | **PASS** | 98 | 90 | Very strong evidence (95-100%) |
| IMG-011 | 4x upscale | **PASS** | 99 | 95 | Very strong evidence (95-100%) |
| IMG-012 | Horizontal flip | **PARTIAL** | n/a | 95 | n/a |
| IMG-014 | 90 degree rotation | **PARTIAL** | n/a | 95 | n/a |

## B-compression

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-021 | JPEG Q90 | **PASS** | 102 | 98 | Very strong evidence (95-100%) |
| IMG-023 | JPEG Q50 | **PASS** | 101 | 90 | Very strong evidence (95-100%) |
| IMG-025 | JPEG Q10 (heavy) | **PASS** | 102 | 70 | Very strong evidence (95-100%) |
| IMG-028 | PNG -> JPEG | **PASS** | 100 | 98 | Very strong evidence (95-100%) |
| IMG-030 | JPEG -> WebP -> JPEG | **PASS** | 102 | 95 | Very strong evidence (95-100%) |
| IMG-035 | Recompress twice (platform reupload sim) | **PASS** | 101 | 90 | Very strong evidence (95-100%) |

## D-visual

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-046 | Brightness +20% | **PASS** | 102 | 95 | Very strong evidence (95-100%) |
| IMG-050 | Saturation +50% | **PASS** | 102 | 95 | Very strong evidence (95-100%) |
| IMG-054 | Black & white | **PASS** | 101 | 90 | Very strong evidence (95-100%) |
| IMG-057 | Gaussian blur | **FALSE_NEGATIVE** | 0 | 85 | Insufficient evidence (<50%) |
| IMG-061 | Gaussian noise | **FALSE_NEGATIVE** | 0 | 85 | Insufficient evidence (<50%) |
| IMG-064 | Local brightness modification (regional) | **PARTIAL** | n/a | 80 | n/a |
| IMG-065 | Local color replacement (regional) | **PARTIAL** | n/a | 80 | n/a |

## E-removal

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-066 | Remove small object (~5%) | **PARTIAL** | n/a | 85 | n/a |
| IMG-068 | Remove large object (~30%) | **PARTIAL** | n/a | 70 | n/a |

## F-addition

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-081 | Add small object (~5%) | **PARTIAL** | n/a | 85 | n/a |
| IMG-089 | Add 50% new content | **PARTIAL** | n/a | 60 | n/a |

## I-ai-composite

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| IMG-121 | AI background + original subject, 50% protected | **FALSE_NEGATIVE** | 0 | 60 | Insufficient evidence (<50%) |
| IMG-123 | AI background + original subject, 10% protected | **FALSE_NEGATIVE** | 0 | 70 | Insufficient evidence (<50%) |
| IMG-124 | AI background + original subject, 5% protected | **FALSE_NEGATIVE** | 0 | 70 | Insufficient evidence (<50%) |
| IMG-127 | AI scene + protected product, 10% protected | **FALSE_NEGATIVE** | 0 | 70 | Insufficient evidence (<50%) |
| IMG-128 | AI scene + protected logo, 5% protected | **FALSE_NEGATIVE** | 0 | 70 | Insufficient evidence (<50%) |
| IMG-135 | AI composite + screenshot-style degradation | **FALSE_NEGATIVE** | 0 | 55 | Insufficient evidence (<50%) |

## negative-control

| ID | Test | Result | Signal | Target | Band |
|---|---|---|---|---|---|
| NEG-001 | Completely unrelated image | **PASS** | n/a | 0 | n/a |
| NEG-002 | Completely unrelated image (larger canvas) | **PASS** | n/a | 0 | n/a |

