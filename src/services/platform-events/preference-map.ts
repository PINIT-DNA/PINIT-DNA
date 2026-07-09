/**
 * Maps notification types → user preference field on User model.
 * null = always deliver (no toggle yet) or uses notifyUpdates for product notices.
 */

export type PrefKey =
  | 'notifyShareAccess'
  | 'notifyRiskAlerts'
  | 'notifyCertificates'
  | 'notifyMonitoring'
  | 'notifyVault'
  | 'notifyDna'
  | 'notifyInvestigation'
  | 'notifyAutomation'
  | 'notifySecurity'
  | 'notifyReports'
  | 'notifySystem'
  | 'notifyUpdates'
  | null;

const TYPE_PREF: Record<string, PrefKey> = {
  // Account / security
  LOGIN_SUCCESS: 'notifySecurity',
  LOGIN_NEW_DEVICE: 'notifySecurity',
  LOGIN_NEW_LOCATION: 'notifySecurity',
  LOGIN_FAILED: 'notifySecurity',
  LOGIN_FAILED_MULTIPLE: 'notifySecurity',
  PASSWORD_CHANGED: 'notifySecurity',
  PASSWORD_RESET_REQUESTED: 'notifySecurity',
  PASSWORD_RESET_COMPLETED: 'notifySecurity',
  EMAIL_CHANGED: 'notifySecurity',
  PHONE_CHANGED: 'notifySecurity',
  MFA_ENABLED: 'notifySecurity',
  MFA_DISABLED: 'notifySecurity',
  SESSION_REVOKED: 'notifySecurity',
  ACCOUNT_LOCKED: 'notifySecurity',
  ACCOUNT_UNLOCKED: 'notifySecurity',

  // Vault
  VAULT_STORED: 'notifyVault',
  VAULT_UPDATED: 'notifyVault',
  VAULT_DELETED: 'notifyVault',
  VAULT_RESTORED: 'notifyVault',
  VAULT_SHARED: 'notifyVault',
  VAULT_ENCRYPTION_FAILED: 'notifyVault',
  VAULT_STORAGE_WARNING: 'notifyVault',
  VAULT_STORAGE_FULL: 'notifyVault',
  PROTECTED_DOWNLOAD_READY: 'notifyVault',
  TEP_CREATED: 'notifyVault',
  TEP_REVOKED: 'notifyVault',
  TEP_EXPIRED: 'notifyVault',
  DOWNLOAD_COMPLETED: 'notifyVault',
  DOWNLOAD_FAILED: 'notifyVault',

  // DNA
  DNA_GENERATED: 'notifyDna',
  DNA_VERIFY_SUCCESS: 'notifyDna',
  DNA_VERIFY_FAILED: 'notifyDna',
  DNA_MISMATCH: 'notifyDna',
  DNA_REGENERATED: 'notifyDna',

  // Certificates
  CERT_GENERATED: 'notifyCertificates',
  CERT_VERIFIED: 'notifyCertificates',
  CERT_REVOKED: 'notifyCertificates',
  CERT_EXPIRED: 'notifyCertificates',
  CERT_VALIDATION_FAILED: 'notifyCertificates',

  // Share
  LINK_CREATED: 'notifyShareAccess',
  LINK_VIEWED: 'notifyShareAccess',
  LINK_DOWNLOADED: 'notifyShareAccess',
  FORWARD_DETECTED: 'notifyShareAccess',
  LINK_REVOKED: 'notifyShareAccess',
  LINK_EXPIRED: 'notifyShareAccess',
  LINK_EXPIRY_WARNING: 'notifyShareAccess',
  LINK_ONE_TIME_CONSUMED: 'notifyShareAccess',
  MAX_DOWNLOADS_REACHED: 'notifyShareAccess',
  SHARE_ACCEPTED: 'notifyShareAccess',
  SHARE_REJECTED: 'notifyShareAccess',
  COPY_ATTEMPT: 'notifyRiskAlerts',
  SCREENSHOT_ATTEMPT: 'notifyRiskAlerts',
  PRINT_ATTEMPT: 'notifyRiskAlerts',
  SCREEN_RECORDING_ATTEMPT: 'notifyRiskAlerts',

  // Policy / risk
  RISK_ALERT: 'notifyRiskAlerts',
  POLICY_BLOCKED: 'notifyRiskAlerts',
  VPN_BLOCKED: 'notifyRiskAlerts',
  TOR_BLOCKED: 'notifyRiskAlerts',
  GEO_BLOCKED: 'notifyRiskAlerts',
  UNAUTHORIZED_ACCESS: 'notifyRiskAlerts',
  DUPLICATE_UPLOAD_ATTEMPT: 'notifyRiskAlerts',

  // Monitoring
  MONITORING_MATCH: 'notifyMonitoring',
  MONITORING_STARTED: 'notifyMonitoring',
  MONITORING_PAUSED: 'notifyMonitoring',
  MONITORING_RESUMED: 'notifyMonitoring',
  MONITORING_STOPPED: 'notifyMonitoring',
  CRAWLER_SCAN_COMPLETED: 'notifyMonitoring',
  CRAWLER_ERROR: 'notifyMonitoring',
  DUPLICATE_INTERNET_COPY: 'notifyMonitoring',
  RISK_INCREASED: 'notifyMonitoring',

  // Investigation
  INVESTIGATION_STARTED: 'notifyInvestigation',
  INVESTIGATION_COMPLETED: 'notifyInvestigation',
  INVESTIGATION_FAILED: 'notifyInvestigation',
  EVIDENCE_READY: 'notifyInvestigation',
  EVIDENCE_EXPORTED: 'notifyInvestigation',
  CASE_CLOSED: 'notifyInvestigation',

  // AI / forensics
  AI_TAMPERING_DETECTED: 'notifyRiskAlerts',
  DEEPFAKE_DETECTED: 'notifyRiskAlerts',
  METADATA_MODIFIED: 'notifyRiskAlerts',
  IMAGE_EDITED: 'notifyRiskAlerts',
  WATERMARK_REMOVED: 'notifyRiskAlerts',

  // Automation
  AUTOMATION_STARTED: 'notifyAutomation',
  AUTOMATION_COMPLETED: 'notifyAutomation',
  AUTOMATION_FAILED: 'notifyAutomation',
  SCHEDULED_SCAN_FINISHED: 'notifyAutomation',

  // Reports
  REPORT_GENERATED: 'notifyReports',
  REPORT_DOWNLOADED: 'notifyReports',
  REPORT_SHARED: 'notifyReports',
  REPORT_EXPORTED: 'notifyReports',

  // System / admin
  USER_REGISTERED: 'notifySystem',
  STORAGE_WARNING: 'notifySystem',
  SYSTEM_MAINTENANCE: 'notifySystem',
  HIGH_RISK_INCIDENT: 'notifyRiskAlerts',
};

export function preferenceKeyForNotificationType(type: string): PrefKey {
  return TYPE_PREF[type] ?? null;
}

export const USER_PREF_SELECT = {
  notifyShareAccess: true,
  notifyRiskAlerts: true,
  notifyCertificates: true,
  notifyMonitoring: true,
  notifyVault: true,
  notifyDna: true,
  notifyInvestigation: true,
  notifyAutomation: true,
  notifySecurity: true,
  notifyReports: true,
  notifySystem: true,
  notifyUpdates: true,
} as const;

export function isPreferenceEnabled(
  user: Record<string, boolean | undefined>,
  pref: PrefKey,
): boolean {
  if (!pref) return true;
  return user[pref] !== false;
}
