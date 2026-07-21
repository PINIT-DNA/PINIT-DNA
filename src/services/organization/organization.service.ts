import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import {
  isOrganizationIndustry,
  type OrganizationIndustry,
} from './constants/organization-profile';

function generateOrgShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) id += chars[bytes[i]! % chars.length];
  return `PINIT-ORG-${id}`;
}

export interface OrganizationView {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  country: string | null;
  logoUrl: string | null;
  setupCompletedAt: string | null;
  setupSkippedAt: string | null;
  welcomeDismissedAt: string | null;
  showWelcome: boolean;
  defaultWorkspace: { id: string; name: string } | null;
}

function toView(org: {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  country: string | null;
  logoUrl: string | null;
  setupCompletedAt: Date | null;
  setupSkippedAt: Date | null;
  welcomeDismissedAt: Date | null;
  workspaces: Array<{ id: string; name: string; isDefault: boolean }>;
}): OrganizationView {
  const defaultWorkspace = org.workspaces.find((w) => w.isDefault) ?? org.workspaces[0] ?? null;
  return {
    id: org.id,
    shortId: org.shortId,
    name: org.name,
    industry: org.industry,
    country: org.country,
    logoUrl: org.logoUrl,
    setupCompletedAt: org.setupCompletedAt?.toISOString() ?? null,
    setupSkippedAt: org.setupSkippedAt?.toISOString() ?? null,
    welcomeDismissedAt: org.welcomeDismissedAt?.toISOString() ?? null,
    showWelcome: !org.setupCompletedAt && !org.setupSkippedAt,
    defaultWorkspace: defaultWorkspace
      ? { id: defaultWorkspace.id, name: defaultWorkspace.name }
      : null,
  };
}

const orgInclude = {
  workspaces: { orderBy: { createdAt: 'asc' as const } },
};

async function assertBusinessOwner(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { accountType: true },
  });
  if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
  if (user.accountType !== 'BUSINESS') {
    throw Object.assign(new Error('Organization is only available for Business accounts'), { status: 403 });
  }
}

export const organizationService = {
  async ensureForOwner(userId: string): Promise<OrganizationView> {
    await assertBusinessOwner(userId);

    const existing = await prisma.organization.findUnique({
      where: { ownerUserId: userId },
      include: orgInclude,
    });
    if (existing) return toView(existing);

    let shortId = generateOrgShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await prisma.organization.findUnique({ where: { shortId } });
      if (!collision) break;
      shortId = generateOrgShortId();
    }

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          shortId,
          ownerUserId: userId,
        },
        include: orgInclude,
      });
      await tx.workspace.create({
        data: {
          organizationId: created.id,
          name: 'Main Workspace',
          isDefault: true,
        },
      });
      return tx.organization.findUniqueOrThrow({
        where: { id: created.id },
        include: orgInclude,
      });
    });

    return toView(org);
  },

  async getForOwner(userId: string): Promise<OrganizationView | null> {
    await assertBusinessOwner(userId);
    const org = await prisma.organization.findUnique({
      where: { ownerUserId: userId },
      include: orgInclude,
    });
    return org ? toView(org) : null;
  },

  async skipWelcome(userId: string): Promise<OrganizationView> {
    const org = await this.ensureForOwner(userId);
    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: { setupSkippedAt: new Date(), welcomeDismissedAt: new Date() },
      include: orgInclude,
    });
    return toView(updated);
  },

  async completeSetup(
    userId: string,
    input: {
      organizationName: string;
      industry?: OrganizationIndustry;
      country?: string;
      workspaceName?: string;
      logoUrl?: string | null;
    },
  ): Promise<OrganizationView> {
    const base = await this.ensureForOwner(userId);
    const organizationName = input.organizationName.trim();
    if (organizationName.length < 2) {
      throw Object.assign(new Error('Organization name must be at least 2 characters'), { status: 400 });
    }
    if (input.industry && !isOrganizationIndustry(input.industry)) {
      throw Object.assign(new Error('Invalid industry'), { status: 400 });
    }

    const workspaceName = (input.workspaceName?.trim() || 'Main Workspace');
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: base.id },
        data: {
          name: organizationName,
          industry: input.industry ?? null,
          country: input.country?.trim() || null,
          logoUrl: input.logoUrl ?? null,
          setupCompletedAt: now,
          welcomeDismissedAt: now,
        },
        include: orgInclude,
      });

      const defaultWs = org.workspaces.find((w) => w.isDefault) ?? org.workspaces[0];
      if (defaultWs) {
        await tx.workspace.update({
          where: { id: defaultWs.id },
          data: { name: workspaceName },
        });
      }

      await tx.user.update({
        where: { id: userId },
        data: {
          organization: organizationName,
          organizationIndustry: input.industry ?? null,
          country: input.country?.trim() || undefined,
          workspaceName,
          businessSetupCompletedAt: now,
        },
      });

      return tx.organization.findUniqueOrThrow({
        where: { id: org.id },
        include: orgInclude,
      });
    });

    return toView(updated);
  },
};
