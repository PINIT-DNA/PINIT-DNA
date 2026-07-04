# Investigation Report Specification

**Status:** Frozen report + manifest contract.

## Principle

UI, PDF, API, and audit logs **all read the Investigation Manifest**.  
No channel invents a different verdict.

## Frozen evidence sections (always present)

Every report contains these sections regardless of media type.  
Empty sections use `N/A` or `SKIPPED`, never omitted.

```text
Identity
Cryptographic Evidence
Media Evidence
Certificate
Timeline
Ownership
Tampering
Confidence
Verdict
```

Optional but recommended when data exists:

```text
Evidence Trail (lifecycle)
Shares / Downloads
Crawler Recoveries
Candidate Scorecards
```

## Investigation Manifest (internal JSON)

Every investigation generates a manifest. Example shape:

```json
{
  "probeId": "uuid",
  "investigationId": "uuid",
  "mediaType": "image",
  "dnaAlgorithmVersion": "15-layer-v1",
  "acceptancePolicyVersion": "acceptance-policy-v1.0",
  "analysisComplete": true,
  "failureReason": null,
  "candidates": [
    {
      "rank": 1,
      "vaultId": "...",
      "dnaRecordId": "...",
      "vectorSimilarity": 0,
      "clipSimilarity": 0,
      "orbScore": 0,
      "pHashSimilarity": 0,
      "dnaScore": 0,
      "dnaClassification": "DIFFERENT",
      "fusionScore": 0,
      "decision": "REJECT",
      "rejectReasons": ["dna_18<42"]
    }
  ],
  "acceptedCandidate": null,
  "verdict": "NOT_PINIT",
  "confidence": 0,
  "confidenceBreakdown": {
    "certificate": { "weight": 25, "score": 0, "contribution": 0, "state": "FAIL" },
    "dna": { "weight": 30, "score": 0, "contribution": 0, "state": "FAIL" },
    "visual": { "weight": 15, "score": 0, "contribution": 0, "state": "FAIL" },
    "metadata": { "weight": 10, "score": 0, "contribution": 0, "state": "SKIPPED" },
    "watermark": { "weight": 10, "score": 0, "contribution": 0, "state": "FAIL" },
    "timeline": { "weight": 5, "score": 0, "contribution": 0, "state": "FAIL" },
    "owner": { "weight": 5, "score": 0, "contribution": 0, "state": "FAIL" }
  },
  "tamper": {},
  "timeline": {},
  "owner": {},
  "certificate": {},
  "vault": {},
  "dna": {},
  "layers": [],
  "scores": {}
}
```

### Verdict codes (manifest)

```text
VERIFIED_ORIGINAL
VERIFIED_DERIVATIVE
POSSIBLE_MATCH
NOT_PINIT
INSUFFICIENT_EVIDENCE
```

## Enterprise report outline

```text
PINIT FORENSIC REPORT

Evidence
Owner
Vault
Certificate
DNA
Timeline
Tampering
Similarity / Scorecard
Original Asset
Recovered Asset (probe)
Evidence Trail
Final Verdict
Confidence
Digital Signature (when applicable)
```

## UI label mapping

| Manifest verdict | UI label |
|------------------|----------|
| VERIFIED_ORIGINAL | Verified PINIT Asset |
| VERIFIED_DERIVATIVE | Original Found — Derivative Detected |
| POSSIBLE_MATCH | Possible PINIT Asset — Needs Manual Review |
| NOT_PINIT | No PINIT Asset Found |
| INSUFFICIENT_EVIDENCE | Insufficient Evidence — Investigation Incomplete |

**Never** map POSSIBLE or incomplete analysis to “Signature Found.”
