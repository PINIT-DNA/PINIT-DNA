import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import {
  isOrganizationIndustry,
  isOrganizationSize,
  type OrganizationIndustry,
  type OrganizationSize,
} from './constants/organization-profile';
import { teamService } from './team.service';
import { logOrgAudit } from './audit-log.service';
import { uploadOrgLogo } from '../../lib/org-logo-storage';

function generateOrgShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) id += chars[bytes[i]! % chars.length];
  return `PINIT-ORG-${id}`;
}

function generateWorkspaceShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) id += chars[bytes[i]! % chars.length];
  return `PINIT-WS-${id}`;
}

export interface OrganizationView {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  organizationSize: OrganizationSize | null;
  businessType: string | null;
  country: string | null;
  website: string | null;
  registrationNumber: string | null;
  gst: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  foundedYear: number | null;
  linkedIn: string | null;
  aboutDescription: string | null;
  services: string | null;
  notes: string | null;
  logoUrl: string | null;
  setupCompletedAt: string | null;
  setupSkippedAt: string | null;
  welcomeDismissedAt: string | null;
  showWelcome: boolean;
  defaultWorkspace: { id: string; shortId: string | null; name: string } | null;
}

type OrgRow = {
  id: string;
  shortId: string;
  name: string | null;
  industry: OrganizationIndustry | null;
  organizationSize: OrganizationSize | null;
  businessType: string | null;
  country: string | null;
  website: string | null;
  registrationNumber: string | null;
  gst: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  foundedYear: number | null;
  linkedIn: string | null;
  aboutDescription: string | null;
  services: string | null;
  notes: string | null;
  logoUrl: string | null;
  setupCompletedAt: Date | null;
  setupSkippedAt: Date | null;
  welcomeDismissedAt: Date | null;
  workspaces: Array<{ id: string; shortId: string | null; name: string; isDefault: boolean }>;
};

function toView(org: OrgRow): OrganizationView {
  const defaultWorkspace = org.workspaces.find((w) => w.isDefault) ?? org.workspaces[0] ?? null;
  return {
    id: org.id,
    shortId: org.shortId,
    name: org.name,
    industry: org.industry,
    organizationSize: org.organizationSize,
    businessType: org.businessType,
    country: org.country,
    website: org.website,
    registrationNumber: org.registrationNumber,
    gst: org.gst,
    addressLine1: org.addressLine1,
    addressLine2: org.addressLine2,
    city: org.city,
    state: org.state,
    postalCode: org.postalCode,
    supportEmail: org.supportEmail,
    supportPhone: org.supportPhone,
    foundedYear: org.foundedYear,
    linkedIn: org.linkedIn,
    aboutDescription: org.aboutDescription,
    services: org.services,
    notes: org.notes,
    logoUrl: org.logoUrl,
    setupCompletedAt: org.setupCompletedAt?.toISOString() ?? null,
    setupSkippedAt: org.setupSkippedAt?.toISOString() ?? null,
    welcomeDismissedAt: org.welcomeDismissedAt?.toISOString() ?? null,
    showWelcome: !org.setupCompletedAt && !org.setupSkippedAt,
    defaultWorkspace: defaultWorkspace
      ? { id: defaultWorkspace.id, shortId: defaultWorkspace.shortId, name: defaultWorkspace.name }
      : null,
  };
}

const orgInclude = {
  workspaces: { orderBy: { createdAt: 'asc' as const } },
};

const ownerProfileSelect = {
  accountType: true,
  organization: true,
  country: true,
  organizationIndustry: true,
  organizationSize: true,
  email: true,
  phone: true,
  workspaceName: true,
  bio: true,
} as const;

function hydrateFromUserProfile(
  user: {
    organization: string | null;
    country: string | null;
    organizationIndustry: OrganizationIndustry | null;
    organizationSize: OrganizationSize | null;
    email: string | null;
    phone: string | null;
    workspaceName: string | null;
    bio: string | null;
  },
  org: {
    name: string | null;
    country: string | null;
    industry: OrganizationIndustry | null;
    organizationSize: OrganizationSize | null;
    supportEmail: string | null;
    supportPhone: string | null;
    aboutDescription: string | null;
  },
) {
  return {
    ...(org.name?.trim() ? {} : user.organization?.trim() ? { name: user.organization.trim() } : {}),
    ...(org.country?.trim() ? {} : user.country?.trim() ? { country: user.country.trim() } : {}),
    ...(org.industry ? {} : user.organizationIndustry ? { industry: user.organizationIndustry } : {}),
    ...(org.organizationSize ? {} : user.organizationSize ? { organizationSize: user.organizationSize } : {}),
    ...(org.supportEmail?.trim() ? {} : user.email?.trim() ? { supportEmail: user.email.trim() } : {}),
    ...(org.supportPhone?.trim() ? {} : user.phone?.trim() ? { supportPhone: user.phone.trim() } : {}),
    ...(org.aboutDescription?.trim() ? {} : user.bio?.trim() ? { aboutDescription: user.bio.trim() } : {}),
  };
}

async function backfillWorkspaceShortIds(organizationId: string) {
  const missing = await prisma.workspace.findMany({
    where: { organizationId, shortId: null },
    select: { id: true },
  });
  for (const ws of missing) {
    let shortId = generateWorkspaceShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await prisma.workspace.findUnique({ where: { shortId } });
      if (!collision) break;
      shortId = generateWorkspaceShortId();
    }
    await prisma.workspace.update({ where: { id: ws.id }, data: { shortId } });
  }
}

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

export interface OrganizationProfileInput {
  organizationName?: string;
  industry?: OrganizationIndustry;
  organizationSize?: OrganizationSize;
  businessType?: string;
  country?: string;
  website?: string;
  registrationNumber?: string;
  gst?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  supportEmail?: string;
  supportPhone?: string;
  foundedYear?: number | string;
  linkedIn?: string;
  aboutDescription?: string;
  services?: string;
  notes?: string;
  workspaceName?: string;
  logoUrl?: string | null;
}

function profileDataFromInput(input: OrganizationProfileInput) {
  return {
    ...(input.organizationName !== undefined ? { name: input.organizationName.trim() } : {}),
    ...(input.industry !== undefined ? { industry: input.industry } : {}),
    ...(input.organizationSize !== undefined ? { organizationSize: input.organizationSize } : {}),
    ...(input.businessType !== undefined ? { businessType: input.businessType.trim() || null } : {}),
    ...(input.country !== undefined ? { country: input.country.trim() || null } : {}),
    ...(input.website !== undefined ? { website: input.website.trim() || null } : {}),
    ...(input.registrationNumber !== undefined
      ? { registrationNumber: input.registrationNumber.trim() || null }
      : {}),
    ...(input.gst !== undefined ? { gst: input.gst.trim() || null } : {}),
    ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1.trim() || null } : {}),
    ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2.trim() || null } : {}),
    ...(input.city !== undefined ? { city: input.city.trim() || null } : {}),
    ...(input.state !== undefined ? { state: input.state.trim() || null } : {}),
    ...(input.postalCode !== undefined ? { postalCode: input.postalCode.trim() || null } : {}),
    ...(input.supportEmail !== undefined ? { supportEmail: input.supportEmail.trim() || null } : {}),
    ...(input.supportPhone !== undefined ? { supportPhone: input.supportPhone.trim() || null } : {}),
    ...(input.foundedYear !== undefined
      ? { foundedYear: input.foundedYear ? Number(input.foundedYear) || null : null }
      : {}),
    ...(input.linkedIn !== undefined ? { linkedIn: input.linkedIn.trim() || null } : {}),
    ...(input.aboutDescription !== undefined
      ? { aboutDescription: input.aboutDescription.trim() || null }
      : {}),
    ...(input.services !== undefined ? { services: input.services.trim() || null } : {}),
    ...(input.notes !== undefined ? { notes: input.notes.trim() || null } : {}),
    ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
  };
}

export const organizationService = {
  async ensureForOwner(userId: string): Promise<OrganizationView> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: ownerProfileSelect,
    });
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 });
    if (user.accountType !== 'BUSINESS') {
      throw Object.assign(new Error('Organization is only available for Business accounts'), { status: 403 });
    }

    const existing = await prisma.organization.findUnique({
      where: { ownerUserId: userId },
      include: orgInclude,
    });
    if (existing) {
      await backfillWorkspaceShortIds(existing.id);
      const patch = hydrateFromUserProfile(user, existing);
      const workspaceName = user.workspaceName?.trim();
      const refreshed = Object.keys(patch).length > 0 || workspaceName
        ? await prisma.$transaction(async (tx) => {
            if (Object.keys(patch).length > 0) {
              await tx.organization.update({ where: { id: existing.id }, data: patch });
            }
            if (workspaceName) {
              const defaultWs = existing.workspaces.find((w) => w.isDefault) ?? existing.workspaces[0];
              if (defaultWs && defaultWs.name === 'Main Workspace') {
                await tx.workspace.update({ where: { id: defaultWs.id }, data: { name: workspaceName } });
              }
            }
            return tx.organization.findUniqueOrThrow({ where: { id: existing.id }, include: orgInclude });
          })
        : await prisma.organization.findUniqueOrThrow({ where: { id: existing.id }, include: orgInclude });
      await teamService.ensureOwnerMember(refreshed.id, userId);
      return toView(refreshed);
    }

    let shortId = generateOrgShortId();
    for (let attempt = 0; attempt < 5; attempt++) {
      const collision = await prisma.organization.findUnique({ where: { shortId } });
      if (!collision) break;
      shortId = generateOrgShortId();
    }

    const createPatch = hydrateFromUserProfile(user, {
      name: null,
      country: null,
      industry: null,
      organizationSize: null,
      supportEmail: null,
      supportPhone: null,
      aboutDescription: null,
    });
    const workspaceLabel = user.workspaceName?.trim() || 'Main Workspace';

    const org = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: { shortId, ownerUserId: userId, ...createPatch },
        include: orgInclude,
      });
      await tx.workspace.create({
        data: {
          organizationId: created.id,
          shortId: generateWorkspaceShortId(),
          name: workspaceLabel,
          isDefault: true,
        },
      });
      return tx.organization.findUniqueOrThrow({
        where: { id: created.id },
        include: orgInclude,
      });
    });

    await teamService.ensureOwnerMember(org.id, userId);
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

  async updateProfile(userId: string, input: OrganizationProfileInput): Promise<OrganizationView> {
    const base = await this.ensureForOwner(userId);
    if (input.industry && !isOrganizationIndustry(input.industry)) {
      throw Object.assign(new Error('Invalid industry'), { status: 400 });
    }
    if (input.organizationSize && !isOrganizationSize(input.organizationSize)) {
      throw Object.assign(new Error('Invalid organization size'), { status: 400 });
    }
    if (input.organizationName !== undefined && input.organizationName.trim().length < 2) {
      throw Object.assign(new Error('Organization name must be at least 2 characters'), { status: 400 });
    }

    const data = profileDataFromInput(input);
    const workspaceName = input.workspaceName?.trim();
    const now = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.update({
        where: { id: base.id },
        data,
        include: orgInclude,
      });

      if (workspaceName && org.workspaces[0]) {
        await tx.workspace.update({
          where: { id: org.workspaces.find((w) => w.isDefault)?.id ?? org.workspaces[0]!.id },
          data: { name: workspaceName },
        });
      }

      if (org.name) {
        await tx.user.update({
          where: { id: userId },
          data: {
            organization: org.name,
            organizationIndustry: org.industry,
            organizationSize: org.organizationSize,
            country: org.country ?? undefined,
            workspaceName: workspaceName ?? org.workspaces[0]?.name,
            businessSetupCompletedAt: org.setupCompletedAt ?? now,
          },
        });
      }

      return tx.organization.findUniqueOrThrow({
        where: { id: org.id },
        include: orgInclude,
      });
    });

    await logOrgAudit({
      organizationId: base.id,
      actorUserId: userId,
      action: 'ORG_PROFILE_UPDATED',
      entityType: 'organization',
      entityId: base.id,
      title: 'Organization profile updated',
    });

    return toView(updated);
  },

  async completeSetup(userId: string, input: OrganizationProfileInput & { organizationName: string }): Promise<OrganizationView> {
    const organizationName = input.organizationName.trim();
    if (organizationName.length < 2) {
      throw Object.assign(new Error('Organization name must be at least 2 characters'), { status: 400 });
    }
    const now = new Date();
    const view = await this.updateProfile(userId, {
      ...input,
      organizationName,
    });
    const updated = await prisma.organization.update({
      where: { id: view.id },
      data: { setupCompletedAt: now, welcomeDismissedAt: now },
      include: orgInclude,
    });
    await prisma.user.update({
      where: { id: userId },
      data: { businessSetupCompletedAt: now },
    });
    await logOrgAudit({
      organizationId: view.id,
      actorUserId: userId,
      action: 'ORG_SETUP_COMPLETED',
      entityType: 'organization',
      entityId: view.id,
      title: 'Organization setup completed',
    });
    return toView(updated);
  },

  async uploadLogo(userId: string, buffer: Buffer, mimeType: string): Promise<OrganizationView> {
    const base = await this.ensureForOwner(userId);
    const logoUrl = await uploadOrgLogo(base.id, buffer, mimeType);
    return this.updateProfile(userId, { logoUrl });
  },

  async getBillingSummary(userId: string) {
    const org = await this.ensureForOwner(userId);
    const sub = await prisma.subscription.findUnique({
      where: { userId },
      include: { plan: true },
    });
    return {
      organizationId: org.id,
      organizationName: org.name,
      planCode: sub?.plan?.code ?? 'FREE',
      planName: sub?.plan?.name ?? 'Free',
      status: sub?.status ?? 'ACTIVE',
      currentPeriodStart: sub?.currentPeriodStart?.toISOString() ?? null,
    };
  },
};
