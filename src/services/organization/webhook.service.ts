import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { entitlementService } from '../subscription/entitlements/entitlement.service';
import { FeatureKey } from '../subscription/constants/features';

export const WEBHOOK_EVENTS = [
  'dna.generated',
  'vault.integrity',
  'share.accessed',
  'share.expired',
  'monitoring.match',
  'integration.test',
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

function signPayload(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function generateSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function isValidHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'));
  } catch {
    return false;
  }
}

export const orgWebhookService = {
  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const rows = await prisma.organizationWebhook.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((w) => ({
      id: w.id,
      name: w.name,
      targetUrl: w.targetUrl,
      events: w.events,
      isActive: w.isActive,
      createdAt: w.createdAt.toISOString(),
      lastDeliveryAt: w.lastDeliveryAt?.toISOString() ?? null,
      lastStatusCode: w.lastStatusCode,
      lastError: w.lastError,
      // Secret only shown once at create; list returns masked hint
      secretHint: `${w.secret.slice(0, 8)}…`,
    }));
  },

  async create(
    organizationId: string,
    actorUserId: string,
    input: { name: string; targetUrl: string; events?: string[] },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const name = input.name.trim();
    const targetUrl = input.targetUrl.trim();
    if (name.length < 2) throw Object.assign(new Error('Name too short'), { status: 400 });
    if (!isValidHttpsUrl(targetUrl)) {
      throw Object.assign(new Error('targetUrl must be https (or http://localhost for testing)'), { status: 400 });
    }
    const events = (input.events?.length ? input.events : ['integration.test']).filter((e) =>
      (WEBHOOK_EVENTS as readonly string[]).includes(e),
    );
    if (events.length === 0) {
      throw Object.assign(new Error('Select at least one valid event'), { status: 400 });
    }

    const secret = generateSecret();
    const row = await prisma.organizationWebhook.create({
      data: {
        organizationId,
        name,
        targetUrl,
        secret,
        events,
        createdByUserId: actorUserId,
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'WEBHOOK_CREATED',
      entityType: 'organization_webhook',
      entityId: row.id,
      title: `Webhook "${row.name}" created`,
    });

    return {
      id: row.id,
      name: row.name,
      targetUrl: row.targetUrl,
      events: row.events,
      isActive: row.isActive,
      secret,
      createdAt: row.createdAt.toISOString(),
    };
  },

  async update(
    organizationId: string,
    actorUserId: string,
    webhookId: string,
    input: { name?: string; targetUrl?: string; events?: string[]; isActive?: boolean },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    const existing = await prisma.organizationWebhook.findFirst({
      where: { id: webhookId, organizationId },
    });
    if (!existing) throw Object.assign(new Error('Webhook not found'), { status: 404 });

    if (input.targetUrl !== undefined && !isValidHttpsUrl(input.targetUrl.trim())) {
      throw Object.assign(new Error('Invalid targetUrl'), { status: 400 });
    }
    const events =
      input.events !== undefined
        ? input.events.filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e))
        : undefined;

    const updated = await prisma.organizationWebhook.update({
      where: { id: webhookId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.targetUrl !== undefined ? { targetUrl: input.targetUrl.trim() } : {}),
        ...(events !== undefined ? { events } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    return {
      id: updated.id,
      name: updated.name,
      targetUrl: updated.targetUrl,
      events: updated.events,
      isActive: updated.isActive,
    };
  },

  async remove(organizationId: string, actorUserId: string, webhookId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    const existing = await prisma.organizationWebhook.findFirst({
      where: { id: webhookId, organizationId },
    });
    if (!existing) throw Object.assign(new Error('Webhook not found'), { status: 404 });
    await prisma.organizationWebhook.delete({ where: { id: webhookId } });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'WEBHOOK_REMOVED',
      entityType: 'organization_webhook',
      entityId: webhookId,
      title: `Webhook "${existing.name}" removed`,
    });
    return { ok: true };
  },

  /** Deliver a signed payload to one webhook endpoint and record result. */
  async deliverOne(
    webhookId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<{ ok: boolean; statusCode: number | null; error: string | null }> {
    const webhook = await prisma.organizationWebhook.findUnique({ where: { id: webhookId } });
    if (!webhook || !webhook.isActive) {
      return { ok: false, statusCode: null, error: 'Webhook inactive or missing' };
    }
    if (!webhook.events.includes(event) && event !== 'integration.test') {
      return { ok: false, statusCode: null, error: 'Event not subscribed' };
    }

    const payload = {
      id: crypto.randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      organizationId: webhook.organizationId,
      data,
    };
    const body = JSON.stringify(payload);
    const signature = signPayload(webhook.secret, body);

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(webhook.targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Pinit-Hub-Webhooks/1.0',
          'X-PinIT-Event': event,
          'X-PinIT-Signature': `sha256=${signature}`,
          'X-PinIT-Delivery': payload.id,
        },
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const ok = res.status >= 200 && res.status < 300;
      await prisma.organizationWebhook.update({
        where: { id: webhookId },
        data: {
          lastDeliveryAt: new Date(),
          lastStatusCode: res.status,
          lastError: ok ? null : `HTTP ${res.status}`,
        },
      });
      return { ok, statusCode: res.status, error: ok ? null : `HTTP ${res.status}` };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Delivery failed';
      await prisma.organizationWebhook.update({
        where: { id: webhookId },
        data: {
          lastDeliveryAt: new Date(),
          lastStatusCode: null,
          lastError: message.slice(0, 500),
        },
      });
      return { ok: false, statusCode: null, error: message };
    }
  },

  async test(organizationId: string, actorUserId: string, webhookId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);
    const webhook = await prisma.organizationWebhook.findFirst({
      where: { id: webhookId, organizationId },
    });
    if (!webhook) throw Object.assign(new Error('Webhook not found'), { status: 404 });

    const result = await this.deliverOne(webhookId, 'integration.test', {
      message: 'Pinit HUB test event',
      triggeredBy: actorUserId,
    });
    return result;
  },

  /** Fire all active org webhooks subscribed to this event (fire-and-forget safe). */
  async dispatch(organizationId: string, event: WebhookEvent, data: Record<string, unknown>) {
    const hooks = await prisma.organizationWebhook.findMany({
      where: {
        organizationId,
        isActive: true,
        events: { has: event },
      },
      select: { id: true },
    });
    await Promise.allSettled(hooks.map((h) => this.deliverOne(h.id, event, data)));
  },
};
