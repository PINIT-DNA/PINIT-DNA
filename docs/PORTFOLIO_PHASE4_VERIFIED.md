# Phase 4 — Verified ledger (not done in Phase 1)

Phase 1 left the public **Verified** section working by still reading
`exchange.hub_assets` at **read time** in Exchange (`portfolio-ledger.js`) when
decorating the Hub published document with shop + ledger.

That table is a **mirror**, not the authority.

The required source is Hub:

- `DnaRecord`
- `AssetVersion`
- `Asset` (`vaultId`, `dnaId`, `certificateId`)
- Hub `Certificate` (protection certificates)

Phase 4 must replace `loadVerifiedLedger` with a Hub API that returns only
public-safe fields (piece title, protected date, certificate public id, kind,
tier derived from `VaultRecord.contentAnalysis` when present). Do **not** add
new writes to `hub_assets`. Do **not** invent human % when analysis is missing.
