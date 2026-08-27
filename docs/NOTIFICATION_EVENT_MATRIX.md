# Notification Event → Recipient Matrix

Generated from `src/services/platform-events/notification-policy.ts`. That file
is the single source of truth; this document is derived from it, so the two
cannot disagree.

## The three classes

| Class | Reaches the bell? | Meaning | Example |
|---|---|---|---|
| **ACTIVITY** | No | Something happened. Timeline only, never a badge. | "The client opened the secure review link." |
| **NOTIFICATION** | Yes | Someone specific needs to know, usually to act. | "Adhureddy requested changes to Version 2 of Campaign X." |
| **ALERT** | Yes | Something is wrong and wants attention now. | "A confirmed external copy of Asset Y was detected." |

Rows written before this distinction existed have a null class and are read as
NOTIFICATION, preserving exactly the behaviour they already had.

## Universal rules

Applied centrally in `resolve()`, so no individual definition can forget one:

1. **Organization gate.** Every recipient must be a member of the organization
   that owns the campaign. A caller-supplied id that fails this is dropped, so
   an assignee who has left cannot be addressed by passing their id.
2. **Never the actor.** Nobody is told about their own action.
3. **De-duplicated.** One row per person per event per entity, enforced by a
   dedupe key of `event:entity:recipient`.

## Never notified, under any definition

- Another organization
- An external creator (`isExternal`), including about their own access
- Members of an unrelated campaign
- Organization members with no relationship to the campaign, unless they are
  leadership AND nobody is assigned to it
- The client — clients receive links, never in-product notifications

## Events that deliberately produce nothing

There is no definition for these, and `emitBusinessEvent` refuses any event not
in the matrix:

| Non-event | Why |
|---|---|
| Monitoring scan completed | A scan running is not news |
| Scan finished with no match | Nothing happened |
| Page view / link read | Activity at most, and already recorded |
| Monitoring enabled / disabled | Lifecycle, not an event anyone must act on |
| Report drafted (not issued) | Classed ACTIVITY — a draft is not news until issued |
| Handover re-opened | Only the first open is a milestone |

## The matrix

### `review.comment_added`

| | |
|---|---|
| **Trigger** | Someone left a comment on a version under review. |
| **Class** | NOTIFICATION |
| **Receives** | People named in the comment + internal members of the campaign (leadership only if nobody is assigned) |
| **Must NOT receive** | Other campaigns, other organizations, external creators not on this asset. |
| **Entity** | `asset` |
| **Recipient action** | Read the comment and reply if it needs an answer. |
| **Preference key** | `CAMPAIGN_MESSAGE` |

### `review.change_requested`

| | |
|---|---|
| **Trigger** | A reviewer asked for changes to a specific version. |
| **Class** | NOTIFICATION |
| **Receives** | Whoever submitted the version + internal members of the campaign |
| **Must NOT receive** | Anyone outside this campaign. Other creators on the campaign who did not submit this version. |
| **Entity** | `version` |
| **Recipient action** | Address the requested change and submit a new version. |
| **Preference key** | `SHARE_REJECTED` |

### `review.version_approved`

| | |
|---|---|
| **Trigger** | A version was approved. Terminal — it will not change again. |
| **Class** | NOTIFICATION |
| **Receives** | Whoever submitted the version + internal members of the campaign |
| **Must NOT receive** | Other campaigns and other organizations. |
| **Entity** | `version` |
| **Recipient action** | The version is signed off and can be handed over. |
| **Preference key** | `SHARE_ACCEPTED` |

### `review.version_submitted`

| | |
|---|---|
| **Trigger** | A new version was submitted and review was requested. |
| **Class** | NOTIFICATION |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | The submitter. Anyone outside the campaign. |
| **Entity** | `version` |
| **Recipient action** | Review the new version. |
| **Preference key** | `CAMPAIGN_MESSAGE` |

### `creator.access_granted`

| | |
|---|---|
| **Trigger** | An external creator was given scoped access to specific assets. |
| **Class** | ACTIVITY |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | The creator themselves through this channel. Other organizations. |
| **Entity** | `campaign` |
| **Recipient action** | None — recorded so the team can see who has access. |
| **Preference key** | `LINK_CREATED` |

### `creator.access_revoked`

| | |
|---|---|
| **Trigger** | An external creator's access was withdrawn. |
| **Class** | NOTIFICATION |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | Other organizations. Other creators. |
| **Entity** | `campaign` |
| **Recipient action** | Confirm the withdrawal was intended. |
| **Preference key** | `LINK_REVOKED` |

### `handover.created`

| | |
|---|---|
| **Trigger** | A handover was assembled for the client. |
| **Class** | ACTIVITY |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | Other campaigns, other organizations, external creators. |
| **Entity** | `handover` |
| **Recipient action** | None — the milestone is the client opening it. |
| **Preference key** | `LINK_CREATED` |

### `handover.opened`

| | |
|---|---|
| **Trigger** | The client opened the handover for the FIRST time. |
| **Class** | NOTIFICATION |
| **Receives** | Whoever created the handover — nobody else |
| **Must NOT receive** | The whole team — only whoever sent it is waiting on this. Re-opens notify nobody. |
| **Entity** | `handover` |
| **Recipient action** | The client has the work. Nothing to do unless they come back. |
| **Preference key** | `SHARE_ACCEPTED` |

### `handover.revoked`

| | |
|---|---|
| **Trigger** | A handover's access was withdrawn. |
| **Class** | NOTIFICATION |
| **Receives** | Whoever created it + internal members of the campaign |
| **Must NOT receive** | The client. Other organizations. |
| **Entity** | `handover` |
| **Recipient action** | Confirm the client no longer needs the assets, or issue a new handover. |
| **Preference key** | `LINK_REVOKED` |

### `rights.attention_needed`

| | |
|---|---|
| **Trigger** | A licence is expiring, expired, or carries a restriction that blocks planned use. |
| **Class** | ALERT |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | Other campaigns and other organizations. Never the client. |
| **Entity** | `asset` |
| **Recipient action** | Renew or re-license before the work is used again. |
| **Preference key** | `RISK_ALERT` |

### `monitoring.discovery_confirmed`

| | |
|---|---|
| **Trigger** | A high-confidence external copy was discovered by a real provider. |
| **Class** | ALERT |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | The client. External creators. Other organizations. |
| **Entity** | `finding` |
| **Recipient action** | Review the match and decide whether it is your work. |
| **Preference key** | `PUBLISH_GUARDIAN_DISCOVERY` |

### `finding.confirmed`

| | |
|---|---|
| **Trigger** | A person judged a match to be their work. |
| **Class** | NOTIFICATION |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | The client. External creators. Other organizations. |
| **Entity** | `finding` |
| **Recipient action** | Decide whether to open an investigation. |
| **Preference key** | `PUBLISH_GUARDIAN_DISCOVERY` |

### `finding.dismissed`

| | |
|---|---|
| **Trigger** | A person judged a match to be unrelated. |
| **Class** | ACTIVITY |
| **Receives** | Internal members of the campaign (timeline only) |
| **Must NOT receive** | Everyone — this is a timeline entry, not a badge. |
| **Entity** | `finding` |
| **Recipient action** | None. Recorded so the decision is auditable. |
| **Preference key** | `PUBLISH_GUARDIAN_DISCOVERY` |

### `investigation.assigned`

| | |
|---|---|
| **Trigger** | A case was assigned to a specific person. |
| **Class** | NOTIFICATION |
| **Receives** | The assignee — nobody else |
| **Must NOT receive** | The rest of the team — being handed a case is personal. |
| **Entity** | `investigation` |
| **Recipient action** | Pick the case up. |
| **Preference key** | `INVESTIGATION_STARTED` |

### `investigation.updated`

| | |
|---|---|
| **Trigger** | A case changed state — opened, moved, closed or reopened. |
| **Class** | NOTIFICATION |
| **Receives** | Case assignee + case opener + internal members of the campaign |
| **Must NOT receive** | Anyone with no relationship to the case or its campaign. |
| **Entity** | `investigation` |
| **Recipient action** | Check where the case stands. |
| **Preference key** | `CASE_CLOSED` |

### `investigation.evidence_added`

| | |
|---|---|
| **Trigger** | Evidence was collected onto a case. |
| **Class** | NOTIFICATION |
| **Receives** | Case assignee + case opener |
| **Must NOT receive** | The whole organization — only the people working the case. |
| **Entity** | `investigation` |
| **Recipient action** | Review what was added. |
| **Preference key** | `EVIDENCE_READY` |

### `report.generated`

| | |
|---|---|
| **Trigger** | A client report was drafted. Not yet visible to anyone outside the team. |
| **Class** | ACTIVITY |
| **Receives** | Internal members of the campaign (timeline only) |
| **Must NOT receive** | Everyone — a draft is not news until it is issued. |
| **Entity** | `report` |
| **Recipient action** | None until it is issued. |
| **Preference key** | `REPORT_GENERATED` |

### `report.issued`

| | |
|---|---|
| **Trigger** | A report was issued to the client and its link now opens. |
| **Class** | NOTIFICATION |
| **Receives** | Internal members of the campaign |
| **Must NOT receive** | The client through this channel. Other organizations. |
| **Entity** | `report` |
| **Recipient action** | Send the client the link if it has not gone out. |
| **Preference key** | `REPORT_SHARED` |

### `report.opened_by_client`

| | |
|---|---|
| **Trigger** | The client opened an issued report for the FIRST time. |
| **Class** | NOTIFICATION |
| **Receives** | Whoever issued the report — nobody else |
| **Must NOT receive** | The team at large. Re-reads notify nobody. |
| **Entity** | `report` |
| **Recipient action** | None. The client has seen it. |
| **Preference key** | `REPORT_DOWNLOADED` |

## Deep links

Every row carries `entityType` and `entityId`, and the link opens the entity
rather than a list page. When a definition's specific id is absent, BOTH the
type and the id fall back to the campaign together — a reference that points at
a campaign while claiming to be a version is worse than a coarser honest one.

| Entity | Link |
|---|---|
| version / asset under review | `/business/campaigns/:id?tab=approvals&asset=:assetId` |
| version list | `/business/campaigns/:id?tab=versions&asset=:assetId` |
| finding | `/business/campaigns/:id?tab=findings&finding=:findingId` |
| investigation | `/business/campaigns/:id?tab=investigations&case=:caseId` |
| handover | `/business/campaigns/:id?tab=handover&handover=:handoverId` |
| creator access | `/business/campaigns/:id?tab=people` |
| rights | `/business/campaigns/:id?tab=rights` |
