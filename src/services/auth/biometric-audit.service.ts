/**
 * Enterprise auth audit trail — security_events + login_history.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { Prisma } from '@prisma/client';

export type SecurityEventType =
  | 'LOGIN'
  | 'LOGOUT'
  | 'FAILED_LOGIN'
  | 'REGISTRATION'
  | 'DUPLICATE_REGISTRATION'
  | 'ACCOUNT_TYPE_LINK'
  | 'BIOMETRIC_MATCH'
  | 'BIOMETRIC_FAILURE'
  | 'DEVICE_ADDED'
  | 'NEW_LOCATION'
  | 'SESSION_REVOKED'
  // Per-modality biometric events. detail{} carries reasons/ids only —
  // never embeddings, raw captures, or similarity distances beyond the
  // server-only duplicate-tuning fields already documented.
  | 'FACE_REGISTERED'
  | 'FACE_DUPLICATE_REJECTED'
  | 'FACE_LOGIN_SUCCESS'
  | 'FACE_LOGIN_FAILED'
  /** 1:N sign-in by face alone — distinct from 1:1 login so the two can be
   *  alerted on separately; a spike here is the brute-force signal. */
  | 'FACE_IDENTIFY_SUCCESS'
  | 'FACE_IDENTIFY_FAILED'
  | 'VOICE_REGISTERED'
  | 'VOICE_DUPLICATE_REJECTED'
  | 'WEBAUTHN_REGISTERED'
  | 'WEBAUTHN_LOGIN_SUCCESS'
  | 'WEBAUTHN_LOGIN_FAILED';

interface AuditContext {
  userId?: string;
  ip?: string;
  userAgent?: string;
  deviceId?: string;
  success?: boolean;
  detail?: Record<string, unknown>;
}

export async function logSecurityEvent(eventType: SecurityEventType, ctx: AuditContext): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        userId: ctx.userId ?? null,
        eventType,
        ip: ctx.ip ?? null,
        userAgent: ctx.userAgent ?? null,
        deviceId: ctx.deviceId ?? null,
        success: ctx.success ?? true,
        detail: (ctx.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (e) {
    logger.warn('Security event log failed', { eventType, error: String(e) });
  }
}

export type LightingStatus = 'OPTIMAL' | 'TOO_DARK' | 'TOO_BRIGHT';

export function sanitizeLoginLighting(raw?: {
  ambientBrightness?: number;
  lightingStatus?: string;
} | null): { ambientBrightness: number | null; lightingStatus: LightingStatus | null } {
  const status = raw?.lightingStatus;
  const lightingStatus: LightingStatus | null =
    status === 'OPTIMAL' || status === 'TOO_DARK' || status === 'TOO_BRIGHT' ? status : null;
  const n = raw?.ambientBrightness;
  const ambientBrightness =
    typeof n === 'number' && Number.isFinite(n) ? Math.round(Math.min(255, Math.max(0, n))) : null;
  return { ambientBrightness, lightingStatus };
}

export async function logLoginHistory(opts: {
  userId: string;
  method: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  failReason?: string;
  ambientBrightness?: number | null;
  lightingStatus?: string | null;
  euclideanDistance?: number | null;
  executionTimeMs?: number | null;
}): Promise<void> {
  try {
    await prisma.loginHistory.create({
      data: {
        userId: opts.userId,
        method: opts.method,
        ip: opts.ip ?? null,
        userAgent: opts.userAgent ?? null,
        success: opts.success,
        failReason: opts.failReason ?? null,
        ambientBrightness: opts.ambientBrightness ?? null,
        lightingStatus: opts.lightingStatus ?? null,
        euclideanDistance:
          typeof opts.euclideanDistance === 'number' && Number.isFinite(opts.euclideanDistance)
            ? opts.euclideanDistance
            : null,
        executionTimeMs:
          typeof opts.executionTimeMs === 'number' && Number.isFinite(opts.executionTimeMs)
            ? opts.executionTimeMs
            : null,
      },
    });
  } catch (e) {
    logger.warn('Login history log failed', { error: String(e) });
  }
}
