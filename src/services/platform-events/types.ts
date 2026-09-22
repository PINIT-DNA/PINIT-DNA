/**
 * Unified Event Engine — canonical event envelope.
 * Modules emit once; subscribers decide notifications, timeline, audit, etc.
 */

export type EventCategory =
  | 'security'
  | 'sharing'
  | 'vault'
  | 'monitoring'
  | 'investigation'
  | 'certificates'
  | 'automation'
  | 'reports'
  | 'account'
  | 'billing'
  | 'system';

export type EventSeverity = 'info' | 'success' | 'warning' | 'medium' | 'critical';

export interface PlatformEventInput {
  name: string;
  category: EventCategory;
  severity: EventSeverity;
  ownerUserId: string;
  actorUserId?: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  deepLink?: string;
  dedupeKey?: string;
  /** When true, notification subscriber may merge into an existing unread row */
  aggregate?: boolean;
  payload?: Record<string, unknown>;
  /** Maps to notifications.type */
  notificationType?: string;
  linkToken?: string;
  fileName?: string;
  ip?: string;
  country?: string;
  device?: string;
  riskLevel?: string;
  /** Skip notification subscriber entirely */
  skipNotification?: boolean;
  /** Skip timeline subscriber (when module already writes provenance) */
  skipTimeline?: boolean;
  /** Skip audit subscriber (when module already writes audit) */
  skipAudit?: boolean;
  /** Context for timeline / audit subscribers */
  dnaRecordId?: string;
  vaultId?: string;
  certificateId?: string;
  shareLinkId?: string;
  investigationId?: string;
  /**
   * Lifecycle layer (additive). Set explicitly by lifecycle emitters; for every
   * existing event the engine derives it from the event name instead, so no
   * existing call site changes.
   */
  lifecycleType?: string;
  /** Canonical Asset.id when the caller already knows it; otherwise resolved. */
  assetId?: string;
  /**
   * Record this event at most once per dedupeKey. Only lifecycle emitters that
   * would otherwise repeat (a thumbnail preview, a refreshed public page) use it;
   * every existing event keeps writing a row per occurrence.
   */
  persistOnce?: boolean;
}

export interface PlatformEventRecord extends PlatformEventInput {
  id: string;
  createdAt: Date;
}
