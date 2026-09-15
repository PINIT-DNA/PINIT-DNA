# Business Account — Final Requirements Matrix

Compiled 2026-08-27. Every row carries the evidence it rests on.

## What the statuses mean

| Status | Meaning |
|---|---|
| **VERIFIED** | Exercised against the live database or a browser, with named evidence |
| **IMPLEMENTED** | Code complete, typechecked, deployed and route-probed — but not yet driven through the authenticated UI |
| **PARTIALLY IMPLEMENTED** | Works for part of its intended scope; the gap is named |
| **NOT CONFIGURED** | Built and waiting on a decision or credential that is not this system's to make |

The distinction between VERIFIED and IMPLEMENTED is deliberate and is the honest
line in this document. An authenticated browser pass over the Business UI has
**not** been done — no session was available and signing in is not something this
process does. Rows that depend on it say IMPLEMENTED, not VERIFIED.

## Deployment

| Item | Evidence |
|---|---|
| Commits | `35bace8`, `8235ab9`, `352e044`, `a2b6870`, `8493808`, `850ad3c` on `org/ashwitha` |
| Render backend | Deployed; every new route answers 401 unauthenticated |
| Vercel frontend | 200; bundle contains the shipped panels |
| Production baseline | `prisma migrate status`: 34 migrations, "Database schema is up to date!" — `DIRECT_URL` configured |
| Schema drift | `prisma migrate diff` empty |
| Backend typecheck | 0 errors |
| Client build | Clean |
| `db:audit` | PASS with 2 known warnings |
| Route protection | 68/68 business routes behind `requireAuth`; 0 accept an organizationId from any client payload |
| Raw SQL | One surface (`campaign-rights.service.ts`, Exchange reader), fully parameterised |

Route registration was proven, not assumed: the public client-report endpoint
returns its own `"Report not found"` where an unregistered path returns the
router's `"Route not found"`.

---

## 1 · Organization, people and access

| Requirement | Status | Evidence |
|---|---|---|
| Organizations, profile, settings | IMPLEMENTED | `organization.service.ts`, routes under `/organization` |
| Members and 5-role RBAC (OWNER · MANAGER · INVESTIGATOR · MEMBER · VIEWER) | VERIFIED | `requireOrgRole` enforced on every new service; cross-org refusals asserted 12× across four suites |
| Departments | IMPLEMENTED | `department.service.ts`, full CRUD routes |
| Workspaces | IMPLEMENTED | `workspace.service.ts`, routes |
| Teams and invites | IMPLEMENTED | `team.service.ts`; emits platform events |
| API keys | IMPLEMENTED | `api-key.service.ts`, routes + `BusinessApiKeysPage` |
| Webhooks | IMPLEMENTED | `webhook.service.ts`, full CRUD |
| Integrations | IMPLEMENTED | `integration.service.ts` |
| Audit logs | VERIFIED | `organization_audit_logs`; every Phase C action writes one; baselines reconciled after each test run |
| Multi-tenant isolation | VERIFIED | Four suites; org B and an external collaborator received **zero** across every action |

## 2 · Clients and campaigns

| Requirement | Status | Evidence |
|---|---|---|
| Clients CRUD | IMPLEMENTED | `client.service.ts`, `ClientsPage` |
| Campaigns CRUD | IMPLEMENTED | `campaign.service.ts` |
| Campaign workspace (14 tabs) | IMPLEMENTED | `CampaignWorkspacePage.tsx`; `soon: true` tabs remaining: **0** |
| Client workspace rollups — Deliveries | VERIFIED | Total reconciled against `campaignHandoverService.list` per campaign **and** a direct `campaignHandover` count |
| Client workspace rollups — Rights | VERIFIED | Total reconciled against `campaignRightsService` per campaign and a direct asset count; state breakdown sums to total |
| Client workspace rollups — Activity | VERIFIED | Every entry scoped to the client's campaigns; no user id or org id in the payload |
| Client workspace rollups — Intelligence | VERIFIED | Asset and finding totals equal direct counts; per-campaign rows sum to totals |
| Client rollups — empty client | VERIFIED | Zero-campaign client returns zeros on all four, no error |
| Client rollups — partial failure | IMPLEMENTED | `Promise.allSettled` + `partial` flag; not yet exercised with a genuinely failing campaign |
| Client Assets / People tabs | PARTIALLY IMPLEMENTED | Still navigational pointers to the campaign-level views. Out of scope of the four placeholders replaced; named here rather than left silent |

## 3 · Protection and review

| Requirement | Status | Evidence |
|---|---|---|
| Asset versions, immutable chain | IMPLEMENTED | `asset-version.service.ts`; APPROVED and SUPERSEDED terminal |
| Review comments / change requests | IMPLEMENTED | `review-comment.service.ts` |
| Approvals, identity-bound and terminal | IMPLEMENTED | `version-approval.service.ts`; insert-only with identity evidence |
| Share links with review permissions | IMPLEMENTED | `reviewMode`, `allowComments`, `allowChangeRequest`, `allowApproval` |
| Campaign messaging, realtime | IMPLEMENTED | `campaign-message.service.ts` on `realtimeHub` |
| External creator scoped access | IMPLEMENTED | `campaign-access.service.ts`; one ShareLink per assigned asset; internal members refused |
| Rights (Exchange read-only) | IMPLEMENTED | `campaign-rights.service.ts`; `deriveRightsState`; Exchange stays source of truth |
| Client handover | IMPLEMENTED | `campaign-handover.service.ts`; approved versions only |

## 4 · Monitoring, findings, investigation, evidence, reports

| Requirement | Status | Evidence |
|---|---|---|
| Monitoring enrol / disable | IMPLEMENTED | `campaign-monitoring.service.ts`; reuses `monitoringService.enroll` |
| Discovery capability, evidence-based | VERIFIED | Live output: reverse-image `NOT_CONFIGURED`, filename `DEGRADED` — "no usable discoveries in 4,212 scans" |
| Findings lifecycle | IMPLEMENTED | `campaign-findings.service.ts`; `PENDING → CONFIRMED / DISMISSED`, both terminal |
| Investigations — case management | VERIFIED | 51/51 assertions: creation, lifecycle, terminal enforcement, reopening, assignment, listing reconciliation |
| Investigations — terminal states | VERIFIED | `setStatus` refuses to leave RESOLVED/DISMISSED; reopen requires MANAGER + written reason; original resolution kept |
| Evidence chain Finding → Investigation → Evidence | VERIFIED | 91/91: relationship, ordering, source/host/timestamp/type/meaning/integrity all present; DB agrees on the link |
| Evidence — search-engine guard | VERIFIED | A DuckDuckGo URL is refused; non-http refused; engine-written types cannot be added by hand |
| Client report generation | VERIFIED | PDF renders (`%PDF-1.7`, 4,165 bytes); report code human; seal recorded |
| Client report — redaction | VERIFIED | Snapshot, JSON and PDF bytes scanned for case/campaign/org/user/report ids and 11 internal field names — **zero hits**; JSON carries exactly 12 allowlisted keys |
| Client report — snapshot immutability | VERIFIED | Evidence added after issue does not appear in the issued client copy |
| Client report — client access | VERIFIED in browser | Report renders, empty-evidence report renders, bad token and revoked token both show the same message, mobile pass, PDF downloads |
| Client report — expiry / revocation | VERIFIED | Expired → 410; revoked → 404; revoked cannot be re-issued |
| Report with no evidence | VERIFIED | Generates, renders, and does not assert anything was found |
| `generateEvidenceReport()` (internal pack) | VERIFIED | **Was broken since it was written** — a `★` in the classification banner threw on every call. Fixed at the drawing primitives; now generates (INCIDENT: 4 pages, 14KB) |

## 5 · Notifications

| Requirement | Status | Evidence |
|---|---|---|
| Phase C events into the existing engine | VERIFIED | `campaign-events.ts`; all five layers emit; no second notification table, no second delivery path |
| Notification types reuse existing preferences | VERIFIED | Every type drawn from `preference-map.ts`; zero new preference keys |
| Correct users receive correct events | VERIFIED | 34/34 with a five-person cast: owner, internal member, bystander, external collaborator, other-org owner |
| Unrelated orgs/users never receive | VERIFIED | Org B and the external collaborator: **zero** notifications across every action, and no platform event addressed to them |
| Actor is never self-notified | VERIFIED | Asserted on every emit path |
| Assignment is private to the assignee | VERIFIED | Rest of the team receives nothing |
| Report-open notifies issuer, first open only | VERIFIED | Re-reads produce no second notification |
| User preferences respected | VERIFIED | A user with `notifyInvestigation: false` receives none while others still do |

## 6 · Reverse-image discovery — NOT CONFIGURED

**This is the one capability that does not work, and it cannot be made to work
from inside this codebase.**

| Requirement | Status | Evidence |
|---|---|---|
| Provider interface | IMPLEMENTED | `ImageSearchProvider` unchanged: `name`, `isConfigured()`, `findCandidates()` |
| Provider registry | IMPLEMENTED | `providers/registry.ts`; `SUPPORTED` is **empty by design** |
| A reverse-image provider | **NOT CONFIGURED** | **No provider has been selected.** None is implemented, none is configured |
| Bing provider | REMOVED | Microsoft retired the Bing Search APIs in August 2025. `BING_SEARCH_API_KEY` cannot be obtained by anyone. Leaving it registered made the system report "missing credentials", which reads as *add a key and this works* — there is no key to add |
| UI shows Not Configured | VERIFIED | Live capability output: `health: "NOT_CONFIGURED"`, reason "No provider is connected, so nothing searches for copies of the image itself" |
| UI shows Degraded | VERIFIED | Filename search: `health: "DEGRADED"`, "Runs, but has produced no usable discoveries in 4,212 scans" |
| Candidates recorded in-product | IMPLEMENTED | Google Cloud Vision Web Detection, TinEye Commercial API, SerpAPI Reverse Image — each with what adopting it takes, rendered in the monitoring panel |
| No fabricated discoveries | VERIFIED | `AssetDiscovery` count: **0**. Nothing in any layer creates one |

### The honest statement about external discovery

**External web and social discovery is NOT operational.** It has never produced
a single real result:

- 4,212 monitoring runs
- 997 runs returned candidates
- **0 matches, all time**
- **0 rows in `AssetDiscovery`**

The 36 `EvidenceRecord` rows that exist are all artifacts of the search-engine
bug: every one cites a search-engine URL, collected 17–19 August 2026 before
`isSearchResultPageUrl` was added, against DNA records that no longer exist and
mapping to zero campaign assets. They belong to no campaign case, so nothing
reaches a client. They have not been deleted — that is the owner's decision.

Nothing in the product claims otherwise. The monitoring panel, the findings
empty state, the campaign intelligence panel and the client intelligence rollup
all carry the capability verdict, and the findings empty state says plainly that
nothing found is not the same as nothing looked for.

**No claim that discovery works should be made until a provider is selected,
configured, and has produced real matches against real assets.**

## 7 · Not verified

| Item | Why |
|---|---|
| Authenticated Business UI browser pass | No session was available; signing in is not something this process does. Covers: Investigations, Evidence, Client Reports (business side), the four Client rollup tabs, and the Monitoring Not Configured state as rendered |
| Client rollup partial-failure banner | Needs a genuinely failing campaign to trigger |
| Handover and Rights manual pass | Previously requested; still outstanding |

Everything in this section is IMPLEMENTED, deployed, route-probed and covered by
automated tests against the live database. What is missing is a human or a
session driving the rendered UI.

## Test totals

| Suite | Assertions |
|---|---|
| Investigations (layer 4) | 51 |
| Evidence + client reports (layers 5–6) | 91 |
| Notifications and isolation | 34 |
| Client rollups | 31 |
| **Total** | **207**, all passing |

Every suite captured baseline row counts and asserted restoration. Final state:
`incidents 36, incident_notes 0, evidence_records 36, client_reports 0,
organization_audit_logs 10, notifications 95, users 3`.
