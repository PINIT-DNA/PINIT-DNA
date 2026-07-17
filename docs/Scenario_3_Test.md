# Scenario 3 Test — Tamper / Crop / Re-Encode

**Status:** Not executed  
**Scenario:** Modified file investigated; correct owner; low confidence → Manual Review.

---

## Prerequisites

- [ ] Protected original file from Scenario 2 (or new DNA + Protect Download)
- [ ] Image editor for: crop, resize, brightness, JPEG re-save
- [ ] Optional: screenshot tool, screen recorder

---

## Test Matrix

| Transformation | Applied? | SHA Match | pHash | Embedding | WM | Owner Correct | Verdict |
|----------------|----------|-----------|-------|-----------|-----|---------------|---------|
| Crop 20% | | | | | | | |
| Resize 50% | | | | | | | |
| Brightness +30% | | | | | | | |
| JPEG Q=60 | | | | | | | |
| PNG → JPEG | | | | | | | |
| Screenshot | | | | | | | |
| Filter (blur) | | | | | | | |
| Small WM crop | | | | | | | |

---

## Steps

| # | Action | Expected Result | Actual Result | Pass |
|---|--------|-----------------|---------------|------|
| 1 | Take protected original | Baseline hash recorded | | |
| 2 | Apply each transform; save as new file | Modified copies ready | | |
| 3 | Unified Investigation → upload each modified file | Pipeline completes | | |
| 4 | Heavy transform: expect Similarity ↓ | Lower confidence | | |
| 5 | Low confidence case shows **“Needs Manual Review”** | Not “Match Found” alone | | |
| 6 | No wrong owner assigned | Owner = original uploader | | |

---

## Evidence Required

1. [ ] Side-by-side original vs modified
2. [ ] Investigation report per transform (at least crop + JPEG)
3. [ ] Confidence score + verdict label screenshot

---

## Pass / Fail

| **Result** | ☐ Pass ☐ Fail ☐ Blocked |

---

## Known Limitations

- Heavy re-encode may destroy watermark.
- Social API seconds-detection not available.
- `ComparePage` not routed — use Unified Investigation.

---

## Fail Notes

*(Fill if Fail)*
