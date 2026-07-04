# Media Adapters

**Status:** Contract — adapters collect evidence only; they never decide verdicts.

## Principle

```text
Media Adapter = probe DNA + media-specific compare inputs
Acceptance Engine = verdict
```

No `if image / if video` verdict logic outside the Acceptance Engine.

## Adapter responsibilities

| Responsibility | Adapter | Shared engine |
|----------------|---------|---------------|
| Detect media type | ✓ | |
| Generate probe DNA / fingerprints | ✓ | |
| Extract media-specific features | ✓ | |
| Candidate search | | ✓ |
| Deep compare orchestration | | ✓ (calls adapter compare) |
| Certificate / timeline / owner | | ✓ |
| Confidence scorecard | | ✓ |
| Acceptance / verdict | | ✓ |
| Manifest + report | | ✓ |

## Adapters (v1)

| Adapter | Probe DNA | Deep compare notes |
|---------|-----------|-------------------|
| Image | Perceptual, ORB, metadata, identity | Frame/image DNA |
| Video | Keyframes, audio, container | Partial / keyframe compare |
| PDF | Structure, text/OCR when available | Document DNA |
| Audio | Audio fingerprint | Audio DNA |
| Office | Structure / text | Document DNA |
| Archive | Listing + member hashes when openable | May yield INSUFFICIENT_EVIDENCE if encrypted |

## SKIPPED layers

Adapters mark inapplicable layers `SKIPPED` (see [03_DNA_SPECIFICATION.md](./03_DNA_SPECIFICATION.md)).

## Failure modes → INSUFFICIENT EVIDENCE

When the adapter cannot run (FFmpeg missing, corrupt codec, encrypted ZIP, OCR crash), it returns:

```json
{
  "analysisComplete": false,
  "failureReason": "ffmpeg_unavailable"
}
```

Acceptance Engine maps this to `INSUFFICIENT_EVIDENCE`, not `NOT_PINIT`.

## Entry points (same engine)

| Source | Difference |
|--------|------------|
| Upload | File picker → probe File |
| Scanner | Camera → probe File (same API) |
| Crawler | Recovered bytes → probe File |
| API / extension / mobile | Same |

Only the **image source** differs; investigation path is identical.
