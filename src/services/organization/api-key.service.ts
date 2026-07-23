import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { requireOrgRole } from './org-access.service';
import { OrganizationMemberRole } from './constants/org-rbac';
import { logOrgAudit } from './audit-log.service';
import { entitlementService } from '../subscription/entitlements/entitlement.service';
import { FeatureKey } from '../subscription/constants/features';

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generateApiKey(): { raw: string; prefix: string; hash: string } {
  const raw = `pinit_${crypto.randomBytes(32).toString('hex')}`;
  const prefix = raw.slice(0, 12);
  return { raw, prefix, hash: hashKey(raw) };
}

export const orgApiKeyService = {
  async list(organizationId: string, actorUserId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.MANAGER);
    const keys = await prisma.organizationApiKey.findMany({
      where: { organizationId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    return keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt.toISOString(),
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    }));
  },

  async create(organizationId: string, actorUserId: string, name: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    await entitlementService.assertFeature(actorUserId, FeatureKey.FEATURE_API_ACCESS);

    const { raw, prefix, hash } = generateApiKey();
    const key = await prisma.organizationApiKey.create({
      data: {
        organizationId,
        name: name.trim(),
        keyPrefix: prefix,
        keyHash: hash,
        createdByUserId: actorUserId,
      },
    });

    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'API_KEY_CREATED',
      entityType: 'organization_api_key',
      entityId: key.id,
      title: `API key "${key.name}" created`,
    });

    return {
      id: key.id,
      name: key.name,
      keyPrefix: key.keyPrefix,
      secret: raw,
      createdAt: key.createdAt.toISOString(),
    };
  },

  async revoke(organizationId: string, actorUserId: string, keyId: string) {
    await requireOrgRole(actorUserId, organizationId, OrganizationMemberRole.OWNER);
    const key = await prisma.organizationApiKey.findFirst({
      where: { id: keyId, organizationId },
    });
    if (!key) throw Object.assign(new Error('API key not found'), { status: 404 });
    await prisma.organizationApiKey.update({
      where: { id: keyId },
      data: { revokedAt: new Date() },
    });
    await logOrgAudit({
      organizationId,
      actorUserId,
      action: 'API_KEY_REVOKED',
      entityType: 'organization_api_key',
      entityId: keyId,
      title: `API key "${key.name}" revoked`,
    });
    return { ok: true };
  },
};
