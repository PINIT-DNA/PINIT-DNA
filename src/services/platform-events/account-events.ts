/**
 * Authentication & account security → platform events.
 */

import { prisma } from '../../lib/prisma';
import { platformEvents } from './platform-event.engine';
import type { PlatformEventInput } from './types';

function accountEvent(partial: Omit<PlatformEventInput, 'category'> & { category?: PlatformEventInput['category'] }): void {
  platformEvents.emit({
    ...partial,
    category: partial.category ?? 'account',
    deepLink: partial.deepLink ?? '/profile?tab=security',
  });
}

export async function notifyLoginSuccess(params: {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  deviceFingerprint?: string | null;
  country?: string | null;
  city?: string | null;
}): Promise<void> {
  const deviceKey = params.deviceFingerprint ?? params.userAgent?.slice(0, 64) ?? 'unknown';

  const knownDevice = await prisma.userDevice.findFirst({
    where: { userId: params.userId, deviceFingerprint: deviceKey },
  }).catch(() => null);

  const recentLogins = await prisma.loginHistory.findMany({
    where: { userId: params.userId, success: true, country: { not: null } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { country: true },
  }).catch(() => []);

  const isNewDevice = !knownDevice;
  const isNewLocation = !!params.country
    && recentLogins.length > 0
    && !recentLogins.some(l => l.country === params.country);

  if (!knownDevice) {
    await prisma.userDevice.upsert({
      where: { userId_deviceFingerprint: { userId: params.userId, deviceFingerprint: deviceKey } },
      create: {
        userId: params.userId,
        deviceFingerprint: deviceKey,
        deviceLabel: params.userAgent?.slice(0, 80) ?? 'Unknown device',
        lastSeenAt: new Date(),
      },
      update: { lastSeenAt: new Date() },
    }).catch(() => {});
  }

  await prisma.loginHistory.create({
    data: {
      userId: params.userId,
      method: 'short_id',
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      country: params.country ?? null,
      city: params.city ?? null,
      success: true,
    },
  }).catch(() => {});

  const base = {
    ownerUserId: params.userId,
    entityType: 'user',
    entityId: params.userId,
    ip: params.ip ?? undefined,
    country: params.country ?? undefined,
    device: params.userAgent?.slice(0, 40),
    skipTimeline: true,
    skipAudit: true,
  };

  accountEvent({
    ...base,
    name: 'account.login.success',
    severity: 'info',
    notificationType: 'LOGIN_SUCCESS',
    title: 'Successful login',
    body: `Signed in from ${params.country ?? params.ip ?? 'unknown location'}`,
    dedupeKey: `login:${params.userId}:${new Date().toISOString().slice(0, 13)}`,
  });

  if (isNewDevice) {
    accountEvent({
      ...base,
      name: 'account.login.new_device',
      severity: 'warning',
      notificationType: 'LOGIN_NEW_DEVICE',
      title: 'Login from new device',
      body: `New device detected: ${params.userAgent?.slice(0, 60) ?? 'Unknown'}`,
      dedupeKey: `login_new_device:${params.userId}:${deviceKey}`,
    });
  }

  if (isNewLocation && params.country) {
    accountEvent({
      ...base,
      name: 'account.login.new_location',
      severity: 'warning',
      notificationType: 'LOGIN_NEW_LOCATION',
      title: 'Login from new location',
      body: `Sign-in from ${params.city ? `${params.city}, ` : ''}${params.country}`,
      dedupeKey: `login_new_loc:${params.userId}:${params.country}`,
    });
  }
}

export async function notifyLoginFailed(params: {
  userId?: string;
  shortId?: string;
  ip?: string | null;
  userAgent?: string | null;
  reason?: string;
}): Promise<void> {
  if (!params.userId) return;

  const since = new Date(Date.now() - 15 * 60 * 1000);
  const failCount = await prisma.loginHistory.count({
    where: { userId: params.userId, success: false, createdAt: { gte: since } },
  }).catch(() => 0);

  await prisma.loginHistory.create({
    data: {
      userId: params.userId,
      method: 'short_id',
      ip: params.ip ?? null,
      userAgent: params.userAgent ?? null,
      success: false,
      failReason: params.reason ?? 'invalid_credentials',
    },
  }).catch(() => {});

  accountEvent({
    name: 'account.login.failed',
    severity: 'warning',
    ownerUserId: params.userId,
    entityType: 'user',
    entityId: params.userId,
    notificationType: failCount >= 2 ? 'LOGIN_FAILED_MULTIPLE' : 'LOGIN_FAILED',
    title: failCount >= 2 ? 'Multiple failed login attempts' : 'Failed login attempt',
    body: params.reason ?? 'Invalid credentials',
    ip: params.ip ?? undefined,
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `login_fail:${params.userId}:${new Date().toISOString().slice(0, 13)}`,
  });
}

export function notifyPasswordChanged(userId: string): void {
  accountEvent({
    name: 'account.password.changed',
    severity: 'info',
    ownerUserId: userId,
    entityType: 'user',
    entityId: userId,
    notificationType: 'PASSWORD_CHANGED',
    title: 'Password changed',
    body: 'Your account password was updated successfully',
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `pwd_changed:${userId}:${Date.now()}`,
  });
}

export function notifySessionRevoked(userId: string, all = false): void {
  accountEvent({
    name: 'account.session.revoked',
    severity: 'info',
    ownerUserId: userId,
    entityType: 'user',
    entityId: userId,
    notificationType: 'SESSION_REVOKED',
    title: all ? 'All sessions revoked' : 'Session revoked',
    body: all ? 'You signed out of all devices' : 'A session was revoked on your account',
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `session_revoked:${userId}:${Date.now()}`,
  });
}

export function notifyEmailChanged(userId: string, email: string): void {
  accountEvent({
    name: 'account.email.changed',
    severity: 'warning',
    ownerUserId: userId,
    entityType: 'user',
    entityId: userId,
    notificationType: 'EMAIL_CHANGED',
    title: 'Email address changed',
    body: `Account email updated to ${email}`,
    skipTimeline: true,
    skipAudit: true,
  });
}

export function notifyPhoneChanged(userId: string): void {
  accountEvent({
    name: 'account.phone.changed',
    severity: 'info',
    ownerUserId: userId,
    entityType: 'user',
    entityId: userId,
    notificationType: 'PHONE_CHANGED',
    title: 'Phone number changed',
    body: 'Your account phone number was updated',
    skipTimeline: true,
    skipAudit: true,
  });
}

export function notifyUserRegistered(userId: string, shortId: string): void {
  accountEvent({
    name: 'account.registered',
    severity: 'success',
    ownerUserId: userId,
    entityType: 'user',
    entityId: userId,
    notificationType: 'USER_REGISTERED',
    title: 'Welcome to Pinit DNA',
    body: `Your account ${shortId} is ready`,
    deepLink: '/dashboard',
    skipTimeline: true,
    skipAudit: true,
    dedupeKey: `registered:${userId}`,
  });
}
