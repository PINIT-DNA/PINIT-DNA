export { platformEvents } from './platform-event.engine';
export type { PlatformEventInput, EventCategory, EventSeverity } from './types';
export { emitShareAccessEvent, emitShareLinkRevoked } from './share-events';
export {
  emitVaultStored,
  emitDnaGenerated,
  emitCertificateIssued,
  emitMonitoringMatch,
  emitDuplicateUploadBlocked,
  emitDuplicateUploadAdminAlert,
  emitInvestigationCompleted,
  emitShareLinkCreated,
  emitSharePolicyBlocked,
  emitVaultDeleted,
  emitCertificateRevoked,
  emitProtectedDownloadReady,
  emitTepRevoked,
} from './module-events';
export {
  notifyLoginSuccess,
  notifyLoginFailed,
  notifyPasswordChanged,
  notifySessionRevoked,
  notifyEmailChanged,
  notifyPhoneChanged,
  notifyUserRegistered,
} from './account-events';
export {
  emitDnaVerifyResult,
  emitDnaMismatch,
  emitCertificateVerified,
  emitCertificateExpired,
  emitShareAccessBlocked,
  emitLinkExpired,
  emitLinkOneTimeConsumed,
  emitMaxDownloadsReached,
  emitMonitoringLifecycle,
  emitCrawlerScanCompleted,
  emitCrawlerError,
  emitInvestigationStarted,
  emitInvestigationFailed,
  emitAiTamperingDetected,
  emitAutomationCompleted,
  emitVaultIntegrityIssue,
  emitTepCreated,
} from './extended-events';
export {
  emitBusinessEvent, describeMatrix, EVENTS, BELL_NOTIFICATION_CLASS_WHERE,
} from './notification-policy';
export type { NotificationClass, EventContext, BusinessEvent } from './notification-policy';
export { realtimeHub } from './realtime-hub';
export { preferenceKeyForNotificationType, USER_PREF_SELECT } from './preference-map';
