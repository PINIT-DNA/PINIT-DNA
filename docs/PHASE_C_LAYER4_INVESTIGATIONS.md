# Phase C · Layer 4 — Investigations

Case management for a campaign. Implemented 2026-08-26.

## The decision that shaped this layer

An investigation model already existed. `Incident` has been in the schema since
the crawler was built: the match pipeline opens one on every detection,
`EvidenceRecord` hangs off it by foreign key, and `AssetDiscovery` already
carried an `investigationId` column waiting for something to fill it.

So this layer **extends `Incident`** rather than adding a second investigation
architecture. Building `Investigation` alongside `Incident` would have split
evidence across two parents and left the crawler writing into a table the UI
never showed.

What was added is only what case management needs and the incident record
lacked: a title, an owner, a campaign, and a written history.

## Schema change

Additive only — nine nullable columns on `incidents`, three indexes, one table.
All 36 pre-existing incidents stayed valid with no backfill (verified: 36 before,
36 after).

| Column on `incidents` | Why |
|---|---|
| `title` | The incident's `description` was an engine-generated sentence, not a case name |
| `organizationId` | Direct tenancy scoping, indexed |
| `campaignId` | The campaign the case belongs to |
| `assetId` | The asset in question |
| `findingId` | The `AssetDiscovery` it was escalated from |
| `assignedToUserId` | Case owner |
| `openedByUserId` / `closedByUserId` / `closedAt` | Who did what, and when |

`severity` is reused as priority and `resolvedNote` as the resolution — no
parallel columns for things that already existed.

New table `incident_notes`: `incidentId`, `authorUserId`, `authorLabel`, `body`,
`isSystem`.

**Why notes are not evidence.** `EvidenceRecord` is a collected artefact with an
integrity hash and a storage path. `IncidentNote` is a person's account of what
they did. Keeping them in one table would let commentary be presented to a client
as evidence, so they are separate in the schema, in the API payload, and in the
UI, which renders them in two distinct sections.

Migration pair, per `docs/DATABASE_MIGRATIONS.md`:
- `prisma/migrations/20260826200000_investigation_cases/migration.sql`
- `scripts/ensure-investigation-cases.cjs` — in the `start:prod` boot chain

## Lifecycle

```
OPEN ──┬─> INVESTIGATING ──┬─> AWAITING_CLIENT ──┬─> RESOLVED   (terminal)
       │        ▲          │         │           └─> DISMISSED  (terminal)
       │        └──────────┴─────────┘
       └─> AWAITING_CLIENT / RESOLVED / DISMISSED
```

`OPEN` is the column's existing default, which is why every incident the crawler
has ever raised is already a valid case.

**Terminal states are terminal.** `RESOLVED` and `DISMISSED` appear on no
right-hand side of the transition table, and `setStatus` refuses to move out of
one. Reopening exists but is a **separate operation**: it needs a distinct call,
a `MANAGER` role, and a written reason, and it leaves a timeline entry attributed
to the person who did it. The original resolution is kept, not erased.

This is the same reasoning that makes an approved version and a decided finding
terminal — a state a client relies on should not be undoable by a mis-click on a
dropdown.

A closed case still accepts notes. Learning something after the fact should be
recordable without reopening the case.

## Escalating a finding

A finding must already be `CONFIRMED` before a case can be opened from it.
Investigating a match nobody has judged to be your work wastes a week. On
escalation, the asset and DNA record are read from the discovery rather than
taken from the caller, and `AssetDiscovery.investigationId` is set — closing the
loop the findings layer left open.

A case can also be opened directly against a campaign, which is what a client
complaint or an off-platform sighting actually is.

## Tenancy

`organizationId` is never accepted from the client; `orgIdFor(req)` derives it
from the session. `loadCaseScoped` then re-proves ownership by two routes —
directly via `organizationId`, or through the case's campaign — because incidents
predate campaign scoping. Both refusal paths are tested.

## Endpoints

| Method | Path | Minimum role |
|---|---|---|
| GET | `/campaigns/:campaignId/investigations` | VIEWER |
| POST | `/campaigns/:campaignId/investigations` | MEMBER |
| GET | `/investigations/:investigationId` | VIEWER |
| PATCH | `/investigations/:investigationId` | MEMBER (MANAGER to reopen) |
| POST | `/investigations/:investigationId/notes` | MEMBER |

`PATCH` takes one intent per call. `reopenReason` is a separate field from
`status` deliberately — reopening is not a value picked from the same dropdown.

## Not exposed

The payload carries no `storagePath`, `tokenSignature`, `otpCodeHash` or
`dnaRecordId`. Evidence integrity is shown as a 12-character hash prefix — enough
to compare, not enough to reconstruct. All four asserted in the test.

## Language

A case is never called infringement. It records what was found and what the team
decided; what that means legally is not this system's call. The same boundary the
findings layer keeps.

## Verification

51/51 automated assertions passed against the live database, covering creation,
tenancy (both refusal paths), notes, the full lifecycle, terminal enforcement,
reopening, assignment, the findings gate, listing reconciliation against a direct
DB count, and payload exposure. The test captured baseline row counts and
asserted every table was restored: `incidents 36→36, incident_notes 0→0,
evidence_records 36→36, asset_discoveries 0→0`.

Typecheck 0 errors, client build clean, `prisma migrate diff` empty, `db:audit`
PASS. All five endpoints answer 401 unauthenticated (404 control confirms the
distinction).

Deployed from `org/ashwitha` at commit `8235ab9`:

- Render backend live after ~220s; all five endpoints answer 401 on
  `https://pinit-dna-uf5y.onrender.com` (they answered 404 before the deploy,
  which is what makes the 401 meaningful)
- Vercel frontend 200, and its bundle contains the panel — `All investigations`,
  `Reopen` and the notes-are-not-evidence line are all present in
  `/static/index-Bs7fTzQx.js`

**Test residue:** the test restored the four tables it tracked, but `logOrgAudit`
writes rows it did not account for — 12 `INVESTIGATION_*` audit rows survived,
all referencing case codes that no longer exist. That is a gap in the test, not
in the service. Worth adding an audit-log baseline to future layer tests.

**Not verified:** the Investigations tab was not exercised in a browser — the
local client had no session and logging in is not something this process does.
The panel is wired at `CampaignWorkspacePage.tsx` and needs a human pass.
