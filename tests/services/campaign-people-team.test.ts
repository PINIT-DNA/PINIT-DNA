/**
 * Campaign People / Team Member management — service-level guarantees.
 *
 * Reuses OrganizationInvite + CampaignMember; does not invent a second invite system.
 */
import { describe, test, expect, jest, beforeEach } from '@jest/globals';

type AnyAsync = (...args: unknown[]) => Promise<unknown>;

const userFindUnique = jest.fn<AnyAsync>();
const userFindMany = jest.fn<AnyAsync>();
const orgMemberFindUnique = jest.fn<AnyAsync>();
const orgMemberFindMany = jest.fn<AnyAsync>();
const orgMemberCreate = jest.fn<AnyAsync>();
const orgInviteFindFirst = jest.fn<AnyAsync>();
const orgInviteFindUnique = jest.fn<AnyAsync>();
const orgInviteFindMany = jest.fn<AnyAsync>();
const orgInviteCreate = jest.fn<AnyAsync>();
const orgInviteUpdate = jest.fn<AnyAsync>();
const orgInviteCount = jest.fn<AnyAsync>();
const campaignFindFirst = jest.fn<AnyAsync>();
const campaignMemberFindUnique = jest.fn<AnyAsync>();
const campaignMemberCreate = jest.fn<AnyAsync>();
const campaignMemberFindMany = jest.fn<AnyAsync>();
const organizationFindFirst = jest.fn<AnyAsync>();
const assetFindMany = jest.fn<AnyAsync>();
const tx = jest.fn<AnyAsync>();

jest.mock('../../src/lib/prisma', () => ({
  prisma: {
    user: { findUnique: userFindUnique, findMany: userFindMany },
    organizationMember: {
      findUnique: orgMemberFindUnique,
      findMany: orgMemberFindMany,
      create: orgMemberCreate,
      count: jest.fn<AnyAsync>().mockResolvedValue(1),
    },
    organizationInvite: {
      findFirst: orgInviteFindFirst,
      findUnique: orgInviteFindUnique,
      findMany: orgInviteFindMany,
      create: orgInviteCreate,
      update: orgInviteUpdate,
      count: orgInviteCount,
    },
    campaign: { findFirst: campaignFindFirst },
    campaignMember: {
      findUnique: campaignMemberFindUnique,
      findMany: campaignMemberFindMany,
      create: campaignMemberCreate,
    },
    organization: { findFirst: organizationFindFirst },
    asset: { findMany: assetFindMany },
    $transaction: tx,
  },
}));

jest.mock('../../src/lib/logger', () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const requireOrgRole = jest.fn<AnyAsync>().mockResolvedValue({ role: 'MANAGER' });
jest.mock('../../src/services/organization/org-access.service', () => ({
  requireOrgRole,
}));

jest.mock('../../src/services/organization/audit-log.service', () => ({
  logOrgAudit: jest.fn<AnyAsync>().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/subscription/entitlements/entitlement.service', () => ({
  entitlementService: {
    getEntitlements: jest.fn<AnyAsync>().mockResolvedValue({ teamMemberLimit: null }),
  },
}));

jest.mock('../../src/services/platform-events/platform-event.engine', () => ({
  platformEvents: { emit: jest.fn() },
}));

import { teamService } from '../../src/services/organization/team.service';
import { campaignService } from '../../src/services/organization/campaign.service';
import { campaignAccessService } from '../../src/services/organization/campaign-access.service';
import { AppError } from '../../src/api/middleware/error.middleware';
import { OrganizationMemberRole } from '../../src/services/organization/constants/org-rbac';

const ORG = 'org-1';
const ACTOR = 'manager-1';
const CAMPAIGN = 'camp-a';
const RAHUL = { id: 'user-rahul', shortId: 'PINIT-RAHUL', fullName: 'Rahul' };

beforeEach(() => {
  jest.clearAllMocks();
  requireOrgRole.mockResolvedValue({ role: 'MANAGER' });
  orgInviteCount.mockResolvedValue(0);
  assetFindMany.mockResolvedValue([]);
  tx.mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops);
    return undefined;
  });
});

describe('lookupByPinitId', () => {
  test('invalid Pinit ID → No Pinit account with that ID', async () => {
    userFindUnique.mockResolvedValue(null);
    await expect(teamService.lookupByPinitId(ORG, ACTOR, 'PINIT-NOPE'))
      .rejects.toMatchObject({ message: 'No Pinit account with that ID', status: 404 });
  });

  test('valid Pinit ID returns safe identity only (name + id flags)', async () => {
    userFindUnique.mockResolvedValue(RAHUL);
    orgMemberFindUnique.mockResolvedValue(null);
    orgInviteFindFirst.mockResolvedValue(null);
    campaignMemberFindUnique.mockResolvedValue(null);

    const account = await teamService.lookupByPinitId(ORG, ACTOR, 'PINIT-RAHUL', { campaignId: CAMPAIGN });
    expect(account).toEqual({
      pinitId: 'PINIT-RAHUL',
      name: 'Rahul',
      alreadyMember: false,
      memberRole: null,
      invitePending: false,
      alreadyOnCampaign: false,
    });
    expect(account).not.toHaveProperty('email');
    expect(account).not.toHaveProperty('userId');
    expect(account).not.toHaveProperty('organizations');
  });

  test('flags alreadyOnCampaign when CampaignMember exists', async () => {
    userFindUnique.mockResolvedValue(RAHUL);
    orgMemberFindUnique.mockResolvedValue({ role: 'MEMBER' });
    orgInviteFindFirst.mockResolvedValue(null);
    campaignMemberFindUnique.mockResolvedValue({ id: 'cm-1' });

    const account = await teamService.lookupByPinitId(ORG, ACTOR, 'PINIT-RAHUL', { campaignId: CAMPAIGN });
    expect(account.alreadyOnCampaign).toBe(true);
    expect(account.alreadyMember).toBe(true);
  });

  test('requires MANAGER', async () => {
    requireOrgRole.mockRejectedValueOnce(new AppError(403, 'Forbidden'));
    await expect(teamService.lookupByPinitId(ORG, ACTOR, 'PINIT-RAHUL'))
      .rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('add existing organization member → CampaignMember', () => {
  test('creates CampaignMember bound to real userId with campaign role', async () => {
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN, name: 'Campaign A', organizationId: ORG });
    orgMemberFindUnique.mockResolvedValue({ role: 'MEMBER' });
    campaignMemberFindUnique.mockResolvedValue(null);
    campaignMemberCreate.mockResolvedValue({
      id: 'cm-new',
      campaignId: CAMPAIGN,
      userId: RAHUL.id,
      name: null,
      platform: null,
      profileUrl: null,
      roleLabel: 'DESIGNER',
      isExternal: false,
      createdAt: new Date('2026-01-01'),
    });
    userFindUnique.mockResolvedValue({ fullName: RAHUL.fullName, shortId: RAHUL.shortId });

    const member = await campaignService.addMember(ORG, ACTOR, CAMPAIGN, {
      memberUserId: RAHUL.id,
      roleLabel: 'DESIGNER',
    });

    expect(campaignMemberCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: CAMPAIGN,
        userId: RAHUL.id,
        roleLabel: 'DESIGNER',
        isExternal: false,
      }),
    });
    expect(member.userId).toBe(RAHUL.id);
    expect(member.roleLabel).toBe('DESIGNER');
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });

  test('resolves memberShortId (Pinit ID) to same CampaignMember', async () => {
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN, name: 'Campaign A', organizationId: ORG });
    userFindUnique
      .mockResolvedValueOnce({ id: RAHUL.id })
      .mockResolvedValueOnce({ fullName: RAHUL.fullName, shortId: RAHUL.shortId });
    orgMemberFindUnique.mockResolvedValue({ role: 'MEMBER' });
    campaignMemberFindUnique.mockResolvedValue(null);
    campaignMemberCreate.mockResolvedValue({
      id: 'cm-new',
      campaignId: CAMPAIGN,
      userId: RAHUL.id,
      name: null,
      platform: null,
      profileUrl: null,
      roleLabel: 'CONTRIBUTOR',
      isExternal: false,
      createdAt: new Date('2026-01-01'),
    });

    await campaignService.addMember(ORG, ACTOR, CAMPAIGN, {
      memberShortId: 'PINIT-RAHUL',
      roleLabel: 'CONTRIBUTOR',
    });

    expect(campaignMemberCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: RAHUL.id, campaignId: CAMPAIGN }),
    });
  });

  test('duplicate CampaignMember prevented (409)', async () => {
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN, name: 'Campaign A', organizationId: ORG });
    orgMemberFindUnique.mockResolvedValue({ role: 'MEMBER' });
    campaignMemberFindUnique.mockResolvedValue({ id: 'cm-existing' });

    await expect(
      campaignService.addMember(ORG, ACTOR, CAMPAIGN, { memberUserId: RAHUL.id, roleLabel: 'REVIEWER' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(campaignMemberCreate).not.toHaveBeenCalled();
  });

  test('unauthorized MEMBER cannot add (requireOrgRole MANAGER)', async () => {
    requireOrgRole.mockRejectedValueOnce(new AppError(403, 'Forbidden'));
    await expect(
      campaignService.addMember(ORG, 'member-only', CAMPAIGN, { memberUserId: RAHUL.id }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(requireOrgRole).toHaveBeenCalledWith(
      'member-only',
      ORG,
      OrganizationMemberRole.MANAGER,
    );
  });

  test('external creator path does not create org membership', async () => {
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN, name: 'Campaign A', organizationId: ORG });
    campaignMemberCreate.mockResolvedValue({
      id: 'cm-ext',
      campaignId: CAMPAIGN,
      userId: null,
      name: 'Isha',
      platform: 'Instagram',
      profileUrl: null,
      roleLabel: 'DESIGNER',
      isExternal: true,
      createdAt: new Date('2026-01-01'),
    });

    const member = await campaignService.addMember(ORG, ACTOR, CAMPAIGN, {
      name: 'Isha',
      platform: 'Instagram',
      roleLabel: 'DESIGNER',
    });

    expect(member.isExternal).toBe(true);
    expect(member.userId).toBeNull();
    expect(orgMemberCreate).not.toHaveBeenCalled();
  });
});

describe('invite by Pinit ID (OrganizationInvite + campaign binding)', () => {
  test('creates invite with campaignId + campaignRole', async () => {
    userFindUnique.mockResolvedValue({ id: RAHUL.id });
    orgMemberFindUnique.mockResolvedValue(null);
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN });
    orgInviteFindFirst.mockResolvedValue(null);
    orgInviteCreate.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-abc',
      expiresAt: new Date('2026-09-01'),
      role: 'MEMBER',
      campaignId: CAMPAIGN,
      campaignRole: 'CONTRIBUTOR',
    });

    const invite = await teamService.inviteMember(ORG, ACTOR, {
      inviteeShortId: 'PINIT-RAHUL',
      role: 'MEMBER',
      campaignId: CAMPAIGN,
      campaignRole: 'CONTRIBUTOR',
    });

    expect(orgInviteCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        inviteeShortId: 'PINIT-RAHUL',
        campaignId: CAMPAIGN,
        campaignRole: 'CONTRIBUTOR',
        role: 'MEMBER',
      }),
    });
    expect(invite.campaignId).toBe(CAMPAIGN);
    expect(invite.alreadyPending).toBe(false);
  });

  test('duplicate pending invitation returns existing (alreadyPending)', async () => {
    userFindUnique.mockResolvedValue({ id: RAHUL.id });
    orgMemberFindUnique.mockResolvedValue(null);
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN });
    orgInviteFindFirst.mockResolvedValue({
      id: 'inv-existing',
      token: 'tok-old',
      expiresAt: new Date('2026-09-01'),
      role: 'MEMBER',
      campaignId: CAMPAIGN,
      campaignRole: 'DESIGNER',
    });

    const invite = await teamService.inviteMember(ORG, ACTOR, {
      inviteeShortId: 'PINIT-RAHUL',
      campaignId: CAMPAIGN,
      campaignRole: 'DESIGNER',
    });

    expect(invite.alreadyPending).toBe(true);
    expect(invite.id).toBe('inv-existing');
    expect(orgInviteCreate).not.toHaveBeenCalled();
  });

  test('correct account accepts → OrganizationMember + CampaignMember for SAME campaign', async () => {
    const inviteRow = {
      id: 'inv-1',
      token: 'tok-abc',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviteeShortId: 'PINIT-RAHUL',
      organizationId: ORG,
      role: 'MEMBER',
      campaignId: CAMPAIGN,
      campaignRole: 'CONTRIBUTOR',
      invitedByUserId: ACTOR,
    };
    orgInviteFindUnique.mockResolvedValue(inviteRow);
    userFindUnique.mockResolvedValue({ shortId: 'PINIT-RAHUL' });
    orgMemberFindUnique.mockResolvedValue(null);
    campaignFindFirst.mockResolvedValue({ id: CAMPAIGN });
    campaignMemberFindUnique.mockResolvedValue(null);
    campaignMemberCreate.mockResolvedValue({ id: 'cm-1' });
    orgInviteUpdate.mockResolvedValue({});
    orgMemberCreate.mockResolvedValue({});

    const result = await teamService.acceptInvite(RAHUL.id, 'tok-abc');

    expect(result.campaignId).toBe(CAMPAIGN);
    expect(result.organizationId).toBe(ORG);
    expect(campaignMemberCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        campaignId: CAMPAIGN,
        userId: RAHUL.id,
        roleLabel: 'CONTRIBUTOR',
        isExternal: false,
      }),
    });
  });

  test('wrong Pinit account rejected', async () => {
    orgInviteFindUnique.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-abc',
      status: 'PENDING',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviteeShortId: 'PINIT-RAHUL',
      organizationId: ORG,
      role: 'MEMBER',
      campaignId: CAMPAIGN,
      campaignRole: 'CONTRIBUTOR',
      invitedByUserId: ACTOR,
    });
    userFindUnique.mockResolvedValue({ shortId: 'PINIT-OTHER' });

    await expect(teamService.acceptInvite('user-other', 'tok-abc'))
      .rejects.toMatchObject({
        message: 'This invitation is for a different Pinit account',
        status: 403,
      });
    expect(campaignMemberCreate).not.toHaveBeenCalled();
  });

  test('already accepted invitation cannot be accepted again', async () => {
    orgInviteFindUnique.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-abc',
      status: 'ACCEPTED',
      expiresAt: new Date(Date.now() + 86_400_000),
      inviteeShortId: 'PINIT-RAHUL',
      organizationId: ORG,
    });

    await expect(teamService.acceptInvite(RAHUL.id, 'tok-abc'))
      .rejects.toMatchObject({ message: 'Invalid or expired invitation', status: 404 });
  });

  test('expired invitation rejected', async () => {
    orgInviteFindUnique.mockResolvedValue({
      id: 'inv-1',
      token: 'tok-abc',
      status: 'PENDING',
      expiresAt: new Date(Date.now() - 1000),
      inviteeShortId: 'PINIT-RAHUL',
      organizationId: ORG,
    });
    orgInviteUpdate.mockResolvedValue({});

    await expect(teamService.acceptInvite(RAHUL.id, 'tok-abc'))
      .rejects.toMatchObject({ message: 'Invitation expired', status: 410 });
  });
});

describe('listPeople merges pending invites', () => {
  test('shows active members and Invitation pending; campaign role ≠ org role', async () => {
    campaignFindFirst.mockResolvedValue({
      id: CAMPAIGN,
      clientId: 'cli-1',
      client: { name: 'Acme', contactName: null, contactEmail: null },
    });
    campaignMemberFindMany.mockResolvedValue([
      {
        id: 'cm-1',
        userId: RAHUL.id,
        name: null,
        email: null,
        platform: null,
        profileUrl: null,
        roleLabel: 'DESIGNER',
        isExternal: false,
        accessStatus: 'ACTIVE',
        canComment: false,
        canRequestChanges: false,
        canApprove: false,
        lastAccessAt: null,
        createdAt: new Date('2026-01-01'),
        assetAccess: [],
      },
    ]);
    userFindMany
      .mockResolvedValueOnce([{ id: RAHUL.id, fullName: 'Rahul', shortId: 'PINIT-RAHUL' }])
      .mockResolvedValueOnce([{ shortId: 'PINIT-NEW', fullName: 'New Hire' }]);
    orgMemberFindMany.mockResolvedValue([{ userId: RAHUL.id, role: 'MEMBER' }]);
    orgInviteFindMany.mockResolvedValue([
      {
        id: 'inv-pend',
        inviteeShortId: 'PINIT-NEW',
        campaignRole: 'REVIEWER',
        role: 'MEMBER',
        createdAt: new Date('2026-01-02'),
        expiresAt: new Date('2026-02-01'),
      },
    ]);

    const result = await campaignAccessService.listPeople(ORG, ACTOR, CAMPAIGN);
    const active = result.people.find((p) => p.id === 'cm-1');
    const pending = result.people.find((p) => p.id === 'invite:inv-pend');

    expect(active).toMatchObject({
      kind: 'internal',
      name: 'Rahul',
      shortId: 'PINIT-RAHUL',
      roleLabel: 'DESIGNER',
      orgRole: 'MEMBER',
      accessStatus: 'ACTIVE',
      pendingInvite: false,
    });
    expect(pending).toMatchObject({
      kind: 'internal',
      name: 'New Hire',
      shortId: 'PINIT-NEW',
      roleLabel: 'REVIEWER',
      accessStatus: 'INVITED',
      pendingInvite: true,
    });
    expect(active?.orgRole).toBe('MEMBER');
  });
});
