# Tamper Matrix

**Status:** Frozen report section for every investigation.

## Principle

Every investigation answers **how the probe differs from the original**, not only “signature found.”

Each flag uses:

| State | Meaning |
|-------|---------|
| `YES` / `DETECTED` | Evidence supports this modification |
| `NO` / `NOT_DETECTED` | Evidence argues against it |
| `UNKNOWN` / `SKIPPED` | Not evaluated or not applicable |

## Standard flags

| Flag | Description |
|------|-------------|
| Original | Probe matches original bytes / full DNA |
| Edited | Non-trivial content edit |
| Compressed | Lossy recompression |
| Screenshot | Screen capture indicators |
| WhatsApp | WhatsApp-style pipeline indicators |
| Crop | Spatial crop |
| Resize | Resolution change |
| Color changed | Color / levels shift |
| Watermark removed | Watermark expected but missing/damaged |
| Metadata removed | Metadata stripped |
| AI generated / AI edited | Generative or AI-edit indicators (when available) |
| Re-encoded | Container/codec change (esp. video) |
| Trimmed | Temporal trim (video) |
| Audio removed / replaced | Audio track change (video) |

## Report presentation

```text
Crop                 YES
Resize               NO
Compression          YES
Metadata Removed     YES
Watermark            RECOVERED | DAMAGED | NOT_EMBEDDED
Certificate          VALID | INVALID | N/A
Screenshot           YES
AI Edited            NO
```

## Link to acceptance

| Tamper | Effect on verdict |
|--------|-------------------|
| None + full DNA + cert | May support VERIFIED ORIGINAL |
| Any DETECTED + original identified | Prefer VERIFIED DERIVATIVE |
| Tamper alone without identity | Does not create a match |

Tamper evidence is forensic output; it does not invent ownership.
