# Evidence Graph

**Status:** Contract for how investigations walk custody data.

## Principle

Do not treat DNA, Vault, Timeline, and Certificate as disconnected blobs.  
Every investigation walks a **connected evidence graph**.

```text
File (probe)
│
├── Owner
├── Vault
├── DNA
├── Certificate
├── Timeline
├── Shares
├── Downloads (protected / TEP)
├── Access Logs
├── Investigation Reports
├── Tampering History
└── Crawler Recoveries
```

## Lifecycle trail (every report)

Ordered events when known:

```text
Created
Encrypted
DNA Generated
Uploaded
Stored
Viewed
Downloaded
Shared
Recovered
Investigated
Verified
```

Missing events appear as `N/A` with reason, not omitted.

## Download and share tracking

| Question | Evidence sources |
|----------|------------------|
| When was original created? | DNA registration, vault `createdAt` |
| Who downloaded? | Protected download, TEP, share access |
| Where (geo)? | IP → geo on view/download |
| Which app / channel? | TEP channel, share link, user-agent; probe fingerprints (WhatsApp compression, etc.) |
| Where recovered? | Investigation probe metadata, crawler URL |
| Public leak? | Crawler / leak intelligence (platform, URL, date) |

### Crawler recovery block (when present)

```text
Recovered
Platform    (e.g. WhatsApp, web, social)
Date
URL
User / account (if known)
```

## Candidate ranking (scale)

Deep compare only on a shortlist—not every vault row.

```text
Vault / object storage (millions)
→ Vector search → Top 100
→ Identity filter → Top 30
→ Media filter → Top 10
→ Deep DNA walk → Top 3
→ Certificate + Timeline + Owner
→ Winner or NOT_PINIT / INSUFFICIENT_EVIDENCE
```

## Implementation note

Use existing Prisma models, TEP, share links, access logs, and crawler tables.  
The graph is a **read model for the manifest and report**, not necessarily a new graph database in v1.
