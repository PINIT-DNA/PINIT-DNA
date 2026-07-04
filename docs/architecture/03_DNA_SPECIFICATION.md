# DNA Specification — Standardized Layers

**DNA algorithm version:** `15-layer-v1`  
**Status:** Frozen schema for reports; implementations may fill SKIPPED per media.

## Principle

Every investigation uses the **same layer slots** regardless of media type.  
Adapters fill what applies; inapplicable layers are **SKIPPED**, never omitted.

## Layer states (every layer)

| State | Meaning |
|-------|---------|
| `PASS` | Evidence present and meets channel threshold |
| `FAIL` | Evidence present and fails threshold |
| `SKIPPED` | Not applicable or not runnable for this media / environment |

Examples:

| Media | Layer | Typical state |
|-------|--------|----------------|
| Video | EXIF / photo metadata | SKIPPED |
| Image | Audio fingerprint | SKIPPED |
| PDF | ORB visual features | SKIPPED |
| Image | ORB | PASS / FAIL |

## Standard 15-layer report map (`15-layer-v1`)

| Layer | Name | Role |
|-------|------|------|
| 1 | Cryptographic | File / content hashes |
| 2 | Embedded Identity | Watermark, identity token, manifest |
| 3 | Metadata | EXIF, container, PDF info |
| 4 | Media Fingerprint | pHash / structure / keyframes / text structure |
| 5 | AI Fingerprint | Embeddings / semantic (when available) |
| 6 | Visual / Audio / Text Features | ORB, audio, OCR features |
| 7 | Vector Embedding | Vault vector similarity |
| 8 | Certificate | Binding and validity |
| 9 | Vault Mapping | Authoritative vault lock |
| 10 | Timeline | Registration and custody events |
| 11 | Similarity | Aggregate media similarity |
| 12 | Owner Verification | Owner bind to vault |
| 13 | Tamper Analysis | Tamper matrix |
| 14 | Recovery Evidence | How identity was recovered |
| 15 | Final Verdict | Set **only** by Acceptance Engine |

Layer 15 is a **report slot** for the acceptance outcome; modules must not write a verdict into layers 1–14.

## DNA versioning

Store on every DNA record and investigation manifest:

```json
"dnaAlgorithmVersion": "15-layer-v1"
```

Future versions (`15-layer-v2`, `20-layer-v1`) must:

- Keep old investigations reproducible under their recorded version
- Not silently reinterpret historical scores

## Implementation note

Existing engine layers (crypto, structural, perceptual, …) **map into** these slots.  
Do not invent a parallel DNA system; align naming and report output to this map.
