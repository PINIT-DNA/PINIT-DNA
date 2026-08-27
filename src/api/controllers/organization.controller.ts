import type { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import { getAuthUserId } from '../../lib/tenant-scope';
import { organizationService } from '../../services/organization/organization.service';
import { teamService } from '../../services/organization/team.service';
import { workspaceService } from '../../services/organization/workspace.service';
import { departmentService } from '../../services/organization/department.service';
import { listOrgAuditLogs } from '../../services/organization/audit-log.service';
import { orgApiKeyService } from '../../services/organization/api-key.service';
import { orgWebhookService, WEBHOOK_EVENTS } from '../../services/organization/webhook.service';
import { orgIntegrationService } from '../../services/organization/integration.service';
import { getOrganizationIdForUser } from '../../services/organization/org-access.service';
import type { OrganizationIndustry, OrganizationSize } from '../../services/organization/constants/organization-profile';
import type { OrganizationMemberRole } from '../../services/organization/constants/org-rbac';

export const orgLogoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

async function orgIdFor(req: Request): Promise<string> {
  const userId = getAuthUserId(req);
  const orgId = await getOrganizationIdForUser(userId);
  if (!orgId) throw Object.assign(new Error('Organization not found'), { status: 404 });
  return orgId;
}

export const organizationController = {
  async getMine(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const organization = await organizationService.ensureForOwner(userId);
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async skipWelcome(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const organization = await organizationService.skipWelcome(userId);
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async completeSetup(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const body = req.body as Record<string, string | undefined>;
      if (!body.organizationName?.trim()) {
        res.status(400).json({ success: false, error: 'organizationName is required' });
        return;
      }
      const organization = await organizationService.completeSetup(userId, {
        organizationName: body.organizationName,
        industry: body.industry as OrganizationIndustry | undefined,
        organizationSize: body.organizationSize as OrganizationSize | undefined,
        businessType: body.businessType,
        country: body.country,
        website: body.website,
        registrationNumber: body.registrationNumber,
        gst: body.gst,
        addressLine1: body.addressLine1,
        addressLine2: body.addressLine2,
        city: body.city,
        state: body.state,
        postalCode: body.postalCode,
        supportEmail: body.supportEmail,
        supportPhone: body.supportPhone,
        workspaceName: body.workspaceName,
        logoUrl: body.logoUrl ?? null,
      });
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const body = req.body as Record<string, string | undefined | null>;
      const organization = await organizationService.updateProfile(userId, {
        organizationName: body.organizationName ?? undefined,
        industry: body.industry as OrganizationIndustry | undefined,
        organizationSize: body.organizationSize as OrganizationSize | undefined,
        businessType: body.businessType ?? undefined,
        country: body.country ?? undefined,
        website: body.website ?? undefined,
        registrationNumber: body.registrationNumber ?? undefined,
        gst: body.gst ?? undefined,
        addressLine1: body.addressLine1 ?? undefined,
        addressLine2: body.addressLine2 ?? undefined,
        city: body.city ?? undefined,
        state: body.state ?? undefined,
        postalCode: body.postalCode ?? undefined,
        supportEmail: body.supportEmail ?? undefined,
        supportPhone: body.supportPhone ?? undefined,
        workspaceName: body.workspaceName ?? undefined,
        logoUrl: body.logoUrl === null ? null : body.logoUrl ?? undefined,
      });
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async uploadLogo(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const file = (req as Request & { file?: Express.Multer.File }).file;
      if (!file) {
        res.status(400).json({ success: false, error: 'Logo file required' });
        return;
      }
      const organization = await organizationService.uploadLogo(userId, file.buffer, file.mimetype);
      res.json({ success: true, organization });
    } catch (err) {
      next(err);
    }
  },

  async getTeam(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const summary = await teamService.getTeamSummary(orgId, userId);
      res.json({ success: true, ...summary });
    } catch (err) {
      next(err);
    }
  },

  async listMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const members = await teamService.listMembers(orgId, userId);
      res.json({ success: true, members });
    } catch (err) {
      next(err);
    }
  },

  async listInvites(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const invites = await teamService.listInvites(orgId, userId);
      res.json({ success: true, invites });
    } catch (err) {
      next(err);
    }
  },

  async lookupPinitId(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const account = await teamService.lookupByPinitId(
        orgId, userId, String(req.query.pinitId ?? ''));
      res.json({ success: true, account });
    } catch (err) { next(err); }
  },

  async listAssignableMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await teamService.listAssignableMembers(
        orgId, userId, String(req.query.campaignId ?? ''));
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  async addMemberToCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const { campaignId, memberUserId, campaignRole } = (req.body ?? {}) as {
        campaignId?: string; memberUserId?: string; campaignRole?: string;
      };
      const member = await teamService.addExistingMemberToCampaign(
        orgId, userId, campaignId ?? '', memberUserId ?? '', campaignRole ?? 'CONTRIBUTOR');
      res.status(201).json({ success: true, member });
    } catch (err) { next(err); }
  },

  async inviteMember(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const { email, inviteeShortId, role, campaignId, campaignRole } = req.body as {
        email?: string;
        inviteeShortId?: string;
        role?: OrganizationMemberRole;
        campaignId?: string;
        campaignRole?: string;
      };
      const invite = await teamService.inviteMember(orgId, userId, {
        email, inviteeShortId, role,
        ...(campaignId ? { campaignId } : {}),
        ...(campaignRole ? { campaignRole } : {}),
      });
      res.json({ success: true, invite });
    } catch (err) {
      next(err);
    }
  },

  async acceptInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const { token } = req.body as { token?: string };
      if (!token?.trim()) {
        res.status(400).json({ success: false, error: 'token is required' });
        return;
      }
      const result = await teamService.acceptInvite(userId, token.trim());
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async revokeInvite(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const inviteId = req.params.id!;
      const result = await teamService.revokeInvite(orgId, userId, inviteId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async updateMemberRole(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const memberId = req.params.id!;
      const { role } = req.body as { role?: OrganizationMemberRole };
      if (!role) {
        res.status(400).json({ success: false, error: 'role is required' });
        return;
      }
      const member = await teamService.updateMemberRole(orgId, userId, memberId, role);
      res.json({ success: true, member });
    } catch (err) {
      next(err);
    }
  },

  async removeMember(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const memberId = req.params.id!;
      const result = await teamService.removeMember(orgId, userId, memberId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async listWorkspaces(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const workspaces = await workspaceService.list(orgId, userId);
      res.json({ success: true, workspaces });
    } catch (err) {
      next(err);
    }
  },

  async createWorkspace(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const { name } = req.body as { name?: string };
      if (!name?.trim()) {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }
      const workspace = await workspaceService.create(orgId, userId, name);
      res.json({ success: true, workspace });
    } catch (err) {
      next(err);
    }
  },

  async listDepartments(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const departments = await departmentService.list(orgId, userId);
      res.json({ success: true, departments });
    } catch (err) {
      next(err);
    }
  },

  async createDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const { name, description } = req.body as { name?: string; description?: string };
      if (!name?.trim()) {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }
      const department = await departmentService.create(orgId, userId, { name, description });
      res.json({ success: true, department });
    } catch (err) {
      next(err);
    }
  },

  async updateDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const departmentId = req.params.id!;
      const { name, description } = req.body as { name?: string; description?: string };
      const department = await departmentService.update(orgId, userId, departmentId, { name, description });
      res.json({ success: true, department });
    } catch (err) {
      next(err);
    }
  },

  async deleteDepartment(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const departmentId = req.params.id!;
      const result = await departmentService.remove(orgId, userId, departmentId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async listAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      await teamService.listMembers(orgId, userId);
      const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 100);
      const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;
      const logs = await listOrgAuditLogs(orgId, limit, offset);
      res.json({ success: true, ...logs });
    } catch (err) {
      next(err);
    }
  },

  async listApiKeys(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const keys = await orgApiKeyService.list(orgId, userId);
      res.json({ success: true, keys });
    } catch (err) {
      next(err);
    }
  },

  async createApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const { name } = req.body as { name?: string };
      if (!name?.trim()) {
        res.status(400).json({ success: false, error: 'name is required' });
        return;
      }
      const key = await orgApiKeyService.create(orgId, userId, name);
      res.json({ success: true, key });
    } catch (err) {
      next(err);
    }
  },

  async revokeApiKey(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const keyId = req.params.id!;
      const result = await orgApiKeyService.revoke(orgId, userId, keyId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async listWebhooks(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const webhooks = await orgWebhookService.list(orgId, userId);
      res.json({ success: true, webhooks, events: WEBHOOK_EVENTS });
    } catch (err) {
      next(err);
    }
  },

  async createWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { name?: string; targetUrl?: string; events?: string[] };
      if (!body.name?.trim() || !body.targetUrl?.trim()) {
        res.status(400).json({ success: false, error: 'name and targetUrl are required' });
        return;
      }
      const webhook = await orgWebhookService.create(orgId, userId, {
        name: body.name,
        targetUrl: body.targetUrl,
        events: body.events,
      });
      res.json({ success: true, webhook });
    } catch (err) {
      next(err);
    }
  },

  async updateWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const webhookId = req.params.id!;
      const body = req.body as {
        name?: string;
        targetUrl?: string;
        events?: string[];
        isActive?: boolean;
      };
      const webhook = await orgWebhookService.update(orgId, userId, webhookId, body);
      res.json({ success: true, webhook });
    } catch (err) {
      next(err);
    }
  },

  async deleteWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const webhookId = req.params.id!;
      const result = await orgWebhookService.remove(orgId, userId, webhookId);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testWebhook(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const webhookId = req.params.id!;
      const result = await orgWebhookService.test(orgId, userId, webhookId);
      res.json({ success: true, delivery: result });
    } catch (err) {
      next(err);
    }
  },

  async listIntegrations(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const [catalog, connected] = await Promise.all([
        Promise.resolve(orgIntegrationService.catalog()),
        orgIntegrationService.list(orgId, userId),
      ]);
      res.json({ success: true, catalog, connected });
    } catch (err) {
      next(err);
    }
  },

  async connectSlack(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { incomingWebhookUrl?: string; channelName?: string };
      if (!body.incomingWebhookUrl?.trim()) {
        res.status(400).json({ success: false, error: 'incomingWebhookUrl is required' });
        return;
      }
      const integration = await orgIntegrationService.connectIncomingWebhook(orgId, userId, 'SLACK', {
        incomingWebhookUrl: body.incomingWebhookUrl,
        displayName: body.channelName,
      });
      res.json({ success: true, integration });
    } catch (err) {
      next(err);
    }
  },

  async connectTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { incomingWebhookUrl?: string; displayName?: string };
      if (!body.incomingWebhookUrl?.trim()) {
        res.status(400).json({ success: false, error: 'incomingWebhookUrl is required' });
        return;
      }
      const integration = await orgIntegrationService.connectIncomingWebhook(
        orgId,
        userId,
        'MICROSOFT_TEAMS',
        { incomingWebhookUrl: body.incomingWebhookUrl, displayName: body.displayName },
      );
      res.json({ success: true, integration });
    } catch (err) {
      next(err);
    }
  },

  async connectZapier(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { incomingWebhookUrl?: string; displayName?: string };
      if (!body.incomingWebhookUrl?.trim()) {
        res.status(400).json({ success: false, error: 'incomingWebhookUrl is required' });
        return;
      }
      const integration = await orgIntegrationService.connectIncomingWebhook(orgId, userId, 'ZAPIER', {
        incomingWebhookUrl: body.incomingWebhookUrl,
        displayName: body.displayName,
      });
      res.json({ success: true, integration });
    } catch (err) {
      next(err);
    }
  },

  async connectDropbox(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { accessToken?: string; displayName?: string };
      if (!body.accessToken?.trim()) {
        res.status(400).json({ success: false, error: 'accessToken is required' });
        return;
      }
      const integration = await orgIntegrationService.connectDropbox(orgId, userId, {
        accessToken: body.accessToken,
        displayName: body.displayName,
      });
      res.json({ success: true, integration });
    } catch (err) {
      next(err);
    }
  },

  async connectGoogleDrive(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const body = req.body as { accessToken?: string; displayName?: string };
      if (!body.accessToken?.trim()) {
        res.status(400).json({ success: false, error: 'accessToken is required' });
        return;
      }
      const integration = await orgIntegrationService.connectGoogleDrive(orgId, userId, {
        accessToken: body.accessToken,
        displayName: body.displayName,
      });
      res.json({ success: true, integration });
    } catch (err) {
      next(err);
    }
  },

  async disconnectIntegration(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const provider = req.params.provider!;
      const result = await orgIntegrationService.disconnect(orgId, userId, provider);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testSlack(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await orgIntegrationService.sendWebhookBridgeTest(orgId, userId, 'SLACK');
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testTeams(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await orgIntegrationService.sendWebhookBridgeTest(
        orgId,
        userId,
        'MICROSOFT_TEAMS',
      );
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testZapier(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await orgIntegrationService.sendWebhookBridgeTest(orgId, userId, 'ZAPIER');
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testDropbox(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await orgIntegrationService.sendStorageTest(orgId, userId, 'DROPBOX');
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async testGoogleDrive(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const orgId = await orgIdFor(req);
      const result = await orgIntegrationService.sendStorageTest(orgId, userId, 'GOOGLE_DRIVE');
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  },

  async getBillingSummary(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = getAuthUserId(req);
      const billing = await organizationService.getBillingSummary(userId);
      res.json({ success: true, billing });
    } catch (err) {
      next(err);
    }
  },
};
