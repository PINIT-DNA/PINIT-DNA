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
}

export interface PlatformEventRecord extends PlatformEventInput {
  id: string;
  createdAt: Date;
}
