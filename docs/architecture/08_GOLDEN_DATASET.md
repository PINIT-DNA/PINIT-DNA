# Golden Dataset (Mandatory)

**Status:** Required before feature expansion.  
**Purpose:** Permanent forensic benchmark; no ad-hoc-only testing.

## Principle

For each **original** vault asset, generate controlled derivatives and run every build against them.  
Track metrics; block merges that regress accuracy.

## Image derivatives (per original)

- Original
- Crop
- Resize
- Rotate
- Brightness
- Contrast
- Blur
- JPEG compression
- WebP conversion
- PNG conversion
- Screenshot
- WhatsApp forward
- Telegram forward
- Instagram download
- Facebook download
- Metadata removed
- Watermark removed
- AI edited
- Re-encoded
- Thumbnail

## Video derivatives (per original)

- Trim start / trim end
- Re-encode
- Different FPS / codec / bitrate
- Cropped
- Audio removed / replaced
- WhatsApp compressed

## PDF derivatives (per original)

- Printed / scanned
- OCR variant
- Metadata removed
- Pages reordered / deleted
- Watermark removed

## Negative controls

- Unrelated images / videos / PDFs (must be NOT_PINIT)
- AI-generated lookalikes (must not assign wrong owner)
- Corrupted / partial files (must be INSUFFICIENT_EVIDENCE, not NOT_PINIT)

## Metrics (track per build)

| Metric | Definition |
|--------|------------|
| Original identification rate | Original → VERIFIED ORIGINAL (correct vault) |
| Derivative identification rate | Derivative → VERIFIED DERIVATIVE (correct vault) |
| False positives | Unrelated → any match verdict |
| False negatives | Known PINIT asset → NOT_PINIT |
| Wrong owner assignments | Match with incorrect owner |
| Wrong Vault ID assignments | Match with incorrect vault |
| Insufficient mislabel rate | Incomplete analysis labeled NOT_PINIT |

## Storage layout (recommended)

```text
/tests/golden/
  manifests/          # expected verdicts per probe
  originals/          # or references to vault IDs
  derivatives/
  negatives/
  results/            # CI outputs (gitignored or artifacts)
```

Exact paths may evolve; the **contract** is: permanent set + expected verdicts + CI gate.
