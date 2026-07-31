# Forensic Provenance & Chain of Custody

## Principle

| Layer | Role |
|-------|------|
| **DNA** | Immutable file identity (never changes) |
| **Forensic Provenance** | Append-only lifecycle events |
| **Investigation Report** | DNA + provenance + TEP + tamper (read-only combine) |

Location, downloads, shares, investigations, and tamper indicators are **events**, not DNA fields.

## Table

`forensic_provenance_events` — insert only, optional `dedupeKey` for idempotency.

## Capture points

| Event | When |
|-------|------|
| `DNA_GENERATED` | Registered DNA complete (`ownerUserId` present — not ephemeral probes) |
| `ENCRYPTED` / `VAULT_STORED` | Vault store |
| `CERTIFICATE_ISSUED` | Certificate issue |
| `PROTECTED_EXPORT` / `TEP_CREATED` | TEP / protected download |
| `INVESTIGATED` / `TAMPERED` | Successful vault match investigation |

## Read path

Investigation loads provenance + **legacy synthesis** from existing DNA/vault/cert/TEP/share tables so older assets still show custody history.

## Privacy

GPS only when granted (stored on share access logs). Otherwise IP country/city/region. Never fabricate location.

## Out of scope (unchanged)

DNA algorithms, 15-layer compare, Acceptance Engine, Candidate Ranking, confidence scorecard.
