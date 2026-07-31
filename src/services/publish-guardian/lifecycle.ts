/**
 * Protected Post lifecycle state machine — explicit transitions only.
 */

export const LIFECYCLE = {
  DRAFT: 'DRAFT',
  PUBLISHING: 'PUBLISHING',
  REGISTERED: 'REGISTERED',
  PROTECTED: 'PROTECTED',
  MONITORING: 'MONITORING',
  DISCOVERY: 'DISCOVERY',
  TAMPERING: 'TAMPERING',
  INVESTIGATION: 'INVESTIGATION',
  EVIDENCE: 'EVIDENCE',
  RESOLVED: 'RESOLVED',
  FAILED: 'FAILED',
  ARCHIVED: 'ARCHIVED',
} as const;

export type LifecycleStatus = (typeof LIFECYCLE)[keyof typeof LIFECYCLE];

/** Allowed transitions: from → to[] */
export const LIFECYCLE_TRANSITIONS: Record<string, readonly string[]> = {
  DRAFT: ['PUBLISHING', 'FAILED', 'ARCHIVED'],
  PUBLISHING: ['REGISTERED', 'PROTECTED', 'MONITORING', 'FAILED'],
  REGISTERED: ['PROTECTED', 'MONITORING', 'FAILED', 'ARCHIVED'],
  PROTECTED: ['MONITORING', 'DISCOVERY', 'FAILED', 'ARCHIVED'],
  MONITORING: ['DISCOVERY', 'TAMPERING', 'RESOLVED', 'FAILED', 'ARCHIVED'],
  DISCOVERY: ['TAMPERING', 'INVESTIGATION', 'EVIDENCE', 'MONITORING', 'RESOLVED', 'ARCHIVED'],
  TAMPERING: ['INVESTIGATION', 'EVIDENCE', 'RESOLVED', 'ARCHIVED'],
  INVESTIGATION: ['EVIDENCE', 'RESOLVED', 'ARCHIVED'],
  EVIDENCE: ['RESOLVED', 'ARCHIVED'],
  RESOLVED: ['MONITORING', 'ARCHIVED'],
  FAILED: ['PUBLISHING', 'REGISTERED', 'ARCHIVED'],
  ARCHIVED: [],
};

export const MONITOR_PROFILE = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  PAUSED: 'PAUSED',
  FAILED: 'FAILED',
  DISABLED: 'DISABLED',
} as const;

export type MonitorProfileStatus = (typeof MONITOR_PROFILE)[keyof typeof MONITOR_PROFILE];

export function canTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = LIFECYCLE_TRANSITIONS[from];
  if (!allowed) return false;
  // MONITORING → stay in monitoring family
  if (from === 'MONITORING' && (to === 'DISCOVERY' || to === 'TAMPERING' || to === 'RESOLVED' || to === 'FAILED' || to === 'ARCHIVED')) {
    return true;
  }
  return allowed.includes(to);
}

export function assertTransition(from: string, to: string): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid ProtectedPost lifecycle transition: ${from} → ${to}`);
  }
}

/** Map Prisma ProtectedPostStatus (may lack DRAFT/PUBLISHING until migration) to lifecycle. */
export function toLifecycle(status: string): string {
  return status;
}
