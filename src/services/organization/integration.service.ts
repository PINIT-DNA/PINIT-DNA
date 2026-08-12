import { prisma } from '../../lib/prisma';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { entitlementService } from '../subscription/entitlements/entitlement.service';
import { FeatureKey } from '../subscription/constants/features';

export const INTEGRATION_PROVIDERS = [
  'SLACK',
  'MICROSOFT_TEAMS',
  'GOOGLE_DRIVE',
  'DROPBOX',
  'ZAPIER',
] as const;

export type IntegrationProvider = (typeof INTEGRATION_PROVIDERS)[number];

type WebhookBridgeProvider = 'SLACK' | 'MICROSOFT_TEAMS' | 'ZAPIER';

const CATALOG: Array<{
  provider: IntegrationProvider | 'WEBHOOKS';
  label: string;
  description: string;
  status: 'available' | 'coming_soon';
}> = [
  {
    provider: 'SLACK',
    label: 'Slack',
    description: 'Send Pinit alerts to a Slack channel via Incoming Webhook (free Slack app).',
    status: 'available',
  },
  {
    provider: 'WEBHOOKS',
    label: 'Webhooks',
    description: 'Push DNA / vault / share events to Exchange or your backend.',
    status: 'available',
  },
  {
    provider: 'MICROSOFT_TEAMS',
    label: 'Microsoft Teams',
    description: 'Post alerts to a Teams channel via Incoming Webhook / Workflow URL.',
    status: 'available',
  },
  {
    provider: 'ZAPIER',
    label: 'Zapier',
    description: 'Trigger Zaps with a Catch Hook URL when Pinit events happen.',
    status: 'available',
  },
  {
    provider: 'GOOGLE_DRIVE',
    label: 'Google Drive',
    description: 'Connect a Drive access token to pull files into Pinit (OAuth token).',
    status: 'available',
  },
  {
    provider: 'DROPBOX',
    label: 'Dropbox',
    description: 'Connect a Dropbox access token to pull files into Pinit.',
    status: 'available',
  },
];

function isHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSlackWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return (
      u.protocol === 'https:' &&
      (u.hostname === 'hooks.slack.com' || u.hostname.endsWith('.slack.com'))
    );
  } catch {
    return false;
  }
}

/** Teams Incoming Webhook / Power Automate Workflow webhook. */
function isTeamsWebhookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return (
      host.endsWith('webhook.office.com') ||
      host.endsWith('office.com') ||
      host.endsWith('logic.azure.com') ||
      host.includes('webhook.office') ||
      host.endsWith('powerplatform.com') ||
      host.endsWith('api.powerautomate.com')
    );
  } catch {
    return false;
  }
}

function isZapierHookUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'hooks.zapier.com';
  } catch {
    return false;
  }
}

function assertWebhookUrl(provider: WebhookBridgeProvider, url: string) {
  if (provider === 'SLACK' && !isSlackWebhookUrl(url)) {
    throw Object.assign(
      new Error('Paste a valid Slack Incoming Webhook URL (https://hooks.slack.com/…)'),
      { status: 400 },
    );
  }
  if (provider === 'MICROSOFT_TEAMS' && !isTeamsWebhookUrl(url)) {
    throw Object.assign(
      new Error(
        'Paste a valid Teams Incoming Webhook or Workflow URL (office.com / logic.azure.com)',
      ),
      { status: 400 },
    );
  }
  if (provider === 'ZAPIER' && !isZapierHookUrl(url)) {
    throw Object.assign(
      new Error('Paste a valid Zapier Catch Hook URL (https://hooks.zapier.com/hooks/catch/…)'),
      { status: 400 },
    );
  }
  if (!isHttpsUrl(url)) {
    throw Object.assign(new Error('Webhook URL must be https'), { status: 400 });
  }
}

const PROVIDER_LABEL: Record<string, string> = {
  SLACK: 'Slack',
  MICROSOFT_TEAMS: 'Microsoft Teams',
  ZAPIER: 'Zapier',
  GOOGLE_DRIVE: 'Google Drive',
  DROPBOX: 'Dropbox',
};

export const orgIntegrationService = {
  catalog() {
    return CATALOG;
  },

  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.VIEWER);
    const rows = await prisma.organizationIntegration.findMany({
      where: { organizationId, disconnectedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      provider: r.provider,
      displayName: r.displayName,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
      connected: true,
    }));
  },

  async connectIncomingWebhook(
    organizationId: string,
    actorUserId: string,
    provider: WebhookBridgeProvider,
    input: { incomingWebhookUrl: string; displayName?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const url = input.incomingWebhookUrl.trim();
    assertWebhookUrl(provider, url);

    const displayName =
      input.displayName?.trim() ||
      (provider === 'SLACK'
        ? 'Slack alerts'
        : provider === 'MICROSOFT_TEAMS'
          ? 'Teams alerts'
          : 'Zapier Catch Hook');

    const row = await prisma.organizationIntegration.upsert({
      where: { organizationId_provider: { organizationId, provider } },
      create: {
        organizationId,
        provider,
        displayName,
        status: 'CONNECTED',
        configJson: { incomingWebhookUrl: url },
        createdByUserId: actorUserId,
        disconnectedAt: null,
      },
      update: {
        displayName,
        status: 'CONNECTED',
        configJson: { incomingWebhookUrl: url },
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'organization_integration',
      entityId: row.id,
      title: `${PROVIDER_LABEL[provider] ?? provider} integration connected`,
    });

    return {
      id: row.id,
      provider: row.provider,
      displayName: row.displayName,
      status: row.status,
    };
  },

  /** @deprecated Prefer connectIncomingWebhook('SLACK', …) */
  async connectSlack(
    organizationId: string,
    actorUserId: string,
    input: { incomingWebhookUrl: string; channelName?: string },
  ) {
    return this.connectIncomingWebhook(organizationId, actorUserId, 'SLACK', {
      incomingWebhookUrl: input.incomingWebhookUrl,
      displayName: input.channelName,
    });
  },

  async connectDropbox(
    organizationId: string,
    actorUserId: string,
    input: { accessToken: string; displayName?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const token = input.accessToken.trim();
    if (token.length < 20) {
      throw Object.assign(new Error('Paste a valid Dropbox access token'), { status: 400 });
    }

    const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: 'null',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Dropbox token rejected: HTTP ${res.status} ${body}`), {
        status: 400,
      });
    }
    const account = (await res.json()) as { name?: { display_name?: string }; email?: string };
    const displayName =
      input.displayName?.trim() ||
      account.name?.display_name ||
      account.email ||
      'Dropbox';

    const row = await prisma.organizationIntegration.upsert({
      where: { organizationId_provider: { organizationId, provider: 'DROPBOX' } },
      create: {
        organizationId,
        provider: 'DROPBOX',
        displayName,
        status: 'CONNECTED',
        configJson: { accessToken: token },
        createdByUserId: actorUserId,
        disconnectedAt: null,
      },
      update: {
        displayName,
        status: 'CONNECTED',
        configJson: { accessToken: token },
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'organization_integration',
      entityId: row.id,
      title: 'Dropbox integration connected',
    });

    return { id: row.id, provider: row.provider, displayName: row.displayName, status: row.status };
  },

  async connectGoogleDrive(
    organizationId: string,
    actorUserId: string,
    input: { accessToken: string; displayName?: string },
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const token = input.accessToken.trim();
    if (token.length < 20) {
      throw Object.assign(new Error('Paste a valid Google OAuth access token'), { status: 400 });
    }

    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw Object.assign(new Error(`Google Drive token rejected: HTTP ${res.status} ${body}`), {
        status: 400,
      });
    }
    const about = (await res.json()) as { user?: { displayName?: string; emailAddress?: string } };
    const displayName =
      input.displayName?.trim() ||
      about.user?.displayName ||
      about.user?.emailAddress ||
      'Google Drive';

    const row = await prisma.organizationIntegration.upsert({
      where: { organizationId_provider: { organizationId, provider: 'GOOGLE_DRIVE' } },
      create: {
        organizationId,
        provider: 'GOOGLE_DRIVE',
        displayName,
        status: 'CONNECTED',
        configJson: { accessToken: token },
        createdByUserId: actorUserId,
        disconnectedAt: null,
      },
      update: {
        displayName,
        status: 'CONNECTED',
        configJson: { accessToken: token },
        disconnectedAt: null,
        updatedAt: new Date(),
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'INTEGRATION_CONNECTED',
      entityType: 'organization_integration',
      entityId: row.id,
      title: 'Google Drive integration connected',
    });

    return { id: row.id, provider: row.provider, displayName: row.displayName, status: row.status };
  },

  async disconnect(organizationId: string, actorUserId: string, provider: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    const row = await prisma.organizationIntegration.findUnique({
      where: { organizationId_provider: { organizationId, provider } },
    });
    if (!row) throw Object.assign(new Error('Integration not found'), { status: 404 });

    await prisma.organizationIntegration.update({
      where: { id: row.id },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        configJson: {},
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'INTEGRATION_DISCONNECTED',
      entityType: 'organization_integration',
      entityId: row.id,
      title: `${provider} integration disconnected`,
    });

    return { ok: true };
  },

  async sendWebhookBridgeTest(
    organizationId: string,
    actorUserId: string,
    provider: WebhookBridgeProvider,
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const row = await prisma.organizationIntegration.findFirst({
      where: { organizationId, provider, disconnectedAt: null, status: 'CONNECTED' },
    });
    if (!row) {
      throw Object.assign(new Error(`${PROVIDER_LABEL[provider] ?? provider} is not connected`), {
        status: 404,
      });
    }

    const config = row.configJson as { incomingWebhookUrl?: string };
    const webhookUrl = config.incomingWebhookUrl;
    if (!webhookUrl) {
      throw Object.assign(new Error('Webhook URL missing'), { status: 400 });
    }

    const label = PROVIDER_LABEL[provider] ?? provider;
    const body =
      provider === 'SLACK'
        ? {
            text: `✅ *Pinit HUB* test alert — ${label} integration is working.`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `*Pinit HUB* · ${label} connected\nThis is a test notification from your Business organization.`,
                },
              },
            ],
          }
        : provider === 'MICROSOFT_TEAMS'
          ? {
              text: `✅ Pinit HUB test alert — ${label} integration is working.`,
            }
          : {
              source: 'pinit-hub',
              event: 'integration.test',
              message: `Pinit HUB test — ${label} Catch Hook is working.`,
              at: new Date().toISOString(),
            };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    await prisma.organizationIntegration.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw Object.assign(new Error(`${label} rejected message: HTTP ${res.status} ${errBody}`), {
        status: 502,
      });
    }

    return { ok: true };
  },

  async sendSlackTest(organizationId: string, actorUserId: string) {
    return this.sendWebhookBridgeTest(organizationId, actorUserId, 'SLACK');
  },

  async sendStorageTest(
    organizationId: string,
    actorUserId: string,
    provider: 'GOOGLE_DRIVE' | 'DROPBOX',
  ) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const row = await prisma.organizationIntegration.findFirst({
      where: { organizationId, provider, disconnectedAt: null, status: 'CONNECTED' },
    });
    if (!row) {
      throw Object.assign(new Error(`${PROVIDER_LABEL[provider]} is not connected`), { status: 404 });
    }
    const config = row.configJson as { accessToken?: string };
    if (!config.accessToken) {
      throw Object.assign(new Error('Access token missing — reconnect'), { status: 400 });
    }

    let ok = false;
    if (provider === 'DROPBOX') {
      const res = await fetch('https://api.dropboxapi.com/2/users/get_current_account', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: 'null',
      });
      ok = res.ok;
      if (!ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`Dropbox test failed: HTTP ${res.status} ${body}`), {
          status: 502,
        });
      }
    } else {
      const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      ok = res.ok;
      if (!ok) {
        const body = await res.text().catch(() => '');
        throw Object.assign(new Error(`Google Drive test failed: HTTP ${res.status} ${body}`), {
          status: 502,
        });
      }
    }

    await prisma.organizationIntegration.update({
      where: { id: row.id },
      data: { lastUsedAt: new Date() },
    });

    return { ok };
  },

  /** Best-effort notify for Slack / Teams / Zapier on org events. */
  async notifyAlertChannels(organizationId: string, text: string, payload?: Record<string, unknown>) {
    const rows = await prisma.organizationIntegration.findMany({
      where: {
        organizationId,
        disconnectedAt: null,
        status: 'CONNECTED',
        provider: { in: ['SLACK', 'MICROSOFT_TEAMS', 'ZAPIER'] },
      },
    });

    await Promise.all(
      rows.map(async (row) => {
        const config = row.configJson as { incomingWebhookUrl?: string };
        if (!config.incomingWebhookUrl) return;
        try {
          const body =
            row.provider === 'SLACK'
              ? { text }
              : row.provider === 'MICROSOFT_TEAMS'
                ? { text }
                : {
                    source: 'pinit-hub',
                    event: (payload?.event as string) ?? 'notification',
                    message: text,
                    ...payload,
                    at: new Date().toISOString(),
                  };
          await fetch(config.incomingWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          await prisma.organizationIntegration.update({
            where: { id: row.id },
            data: { lastUsedAt: new Date() },
          });
        } catch {
          /* best-effort */
        }
      }),
    );
  },

  async notifySlack(organizationId: string, text: string) {
    await this.notifyAlertChannels(organizationId, text);
  },
};
