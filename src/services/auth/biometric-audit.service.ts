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
  | 'BIOMETRIC_MATCH'
  | 'BIOMETRIC_FAILURE'
  | 'DEVICE_ADDED'
  | 'NEW_LOCATION'
  | 'SESSION_REVOKED';

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

export async function logLoginHistory(opts: {
  userId: string;
  method: string;
  ip?: string;
  userAgent?: string;
  success: boolean;
  failReason?: string;
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
      },
    });
  } catch (e) {
    logger.warn('Login history log failed', { error: String(e) });
  }
}
