# Network Intelligence — gap report

Discovery only. **Nothing was implemented.** This records what the database can
already answer, what it cannot, and what would have to exist first.

Date: 2026-09-09 · read from `prisma/schema.prisma` on branch `ashwitha`

No counts appear in this report. The figures in the vision material — 23
agencies, 41 campaigns, 126 creators, 247 websites, 1,842 assets — are
illustrative, and I have not queried production to replace them with real ones.

---

## 1. Edges that already exist

These are real relations or resolvable joins today. The Asset Relationship Graph
built in this stage assembles exactly this set and nothing more.

| Edge | How | Strength |
|---|---|---|
| Asset → Owner | `Asset.ownerUserId` → `User` | Relation |
| Asset → Campaign | `Asset.campaignId` → `Campaign` | Relation |
| Campaign → Client (brand) | `Campaign.clientId` → `Client` | Relation |
| Campaign → Organisation (agency) | `Campaign.organizationId` → `Organization` | Relation |
| Asset → DNA | `Asset.dnaId` → `DnaRecord` | Relation |
| Asset → Versions | `AssetVersion.assetId` | Relation |
| Asset → Published platforms | `AssetPlatformLink.assetId` | Relation |
| Asset → Protected posts | `ProtectedPost.assetId` | Relation |
| Asset → Discoveries | `AssetDiscovery.assetId` | Relation |
| Asset → Timeline | `AssetTimelineEvent.assetId` | Relation |
| Asset → Evidence | `Asset.dnaId` = `EvidenceRecord.dnaRecordId` | **Soft join** |

That is enough to answer questions about **one asset**, which is what the graph
endpoint now does.

---

## 2. What is missing

### 2.1 There is no asset-to-asset edge

`Asset` has no self-relation. `AssetVersion` records revisions *within* one
asset; it does not connect two assets. So the platform cannot currently express:

- this asset is a derivative of that asset
- these two assets came from the same shoot
- this asset appears inside that composite

Derivative lineage is the single largest gap. Network Intelligence is mostly a
statement about how assets relate to *each other*, and that edge does not exist.

### 2.2 Websites and publishers are strings, not entities

`AssetPlatformLink` stores `platform` and `url` as text. `AssetDiscovery` does
the same. There is no `Website` or `Publisher` row, so:

- the same site appearing against fifty assets is fifty unrelated strings
- "which publishers use our work most" cannot be asked
- no site can carry a reputation, a licence history, or a takedown record

Counting distinct websites today would mean normalising URLs at query time and
would produce a number nobody could act on.

### 2.3 Three identity links have no referential integrity

`Asset.vaultId`, `Asset.certificateId` and `Asset.monitorRecordId` are plain
`String?` columns, not relations. `EvidenceRecord.dnaRecordId` is the same. They
resolve in practice, but the database does not enforce them and Prisma cannot
traverse them, so every hop is a separate query and a dangling id fails silently.

### 2.4 Everything is owner-scoped

Every query in the asset services is filtered by `ownerUserId`. That is correct
for tenant isolation and must not be relaxed casually — but it means there is
currently no legitimate read path that spans owners. Network Intelligence is by
definition cross-owner, so it needs a deliberate aggregate layer with its own
authorisation rules, not a loosened filter.

### 2.5 Exchange is a separate database

Licences, listings and sales live in Exchange, reachable only over the bridge
with a shared secret. There is no join path from a Hub asset to its licences, so
"which brands licensed this creator's work" cannot be answered in one query.

---

## 3. What would be required, in order

1. **Asset ↔ Asset edges.** A join table with an explicit relationship kind
   (derivative, variant, component) and a provenance field recording whether the
   link was asserted by a person or inferred by comparison. Without the
   provenance field the graph cannot distinguish a proven relationship from a
   suspected one, which is the distinction the product rests on.

2. **Website and Publisher as entities.** Normalise the host out of
   `AssetPlatformLink.url` and `AssetDiscovery.url` into a `Website` row, and
   point both at it. This is the change that turns discoveries into a network.

3. **Promote the three soft links to relations.** `vaultId`, `certificateId`,
   `monitorRecordId` and `EvidenceRecord.dnaRecordId`. Additive and safe; the
   existing `ensure-asset-linkage.cjs` already backfills two of them and reports
   what it cannot prove.

4. **A cross-owner aggregate layer** with its own authorisation model, so
   network figures never come from relaxing a tenant filter.

5. **An Exchange projection into Hub** — licence facts mirrored across the
   bridge — so rights can join the graph without a cross-database query.

Only after 1 and 2 does a count like "247 websites" mean anything. Until then
any such figure would be a string-distinct over unnormalised URLs.

---

## 4. Recommendation

Do not implement Network Intelligence yet, and do not display network counts.

The honest intermediate step is the one now built: **the per-asset relationship
graph**, which shows real connections for a single asset and omits every group
it has no members for. It is the same data a network view would aggregate, and
it earns trust before any number claims to summarise thousands of assets.
