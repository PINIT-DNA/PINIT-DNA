import type { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { getOrganizationIdForUser } from '../../services/organization/org-access.service';
import { clientService } from '../../services/organization/client.service';
import { campaignService } from '../../services/organization/campaign.service';
import { AppError } from '../middleware/error.middleware';

async function orgIdFor(req: Request): Promise<{ userId: string; organizationId: string }> {
  const userId = getAuthUserId(req);
  const organizationId = await getOrganizationIdForUser(userId);
  if (!organizationId) throw new AppError(404, 'Business account not found');
  return { userId, organizationId };
}

export const businessController = {
  // ── Clients ───────────────────────────────────────────────────────────
  async listClients(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const clients = await clientService.list(organizationId, userId);
      res.json({ success: true, clients });
    } catch (err) { next(err); }
  },

  async getClient(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const client = await clientService.get(organizationId, userId, req.params.clientId as string);
      res.json({ success: true, client });
    } catch (err) { next(err); }
  },

  async createClient(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const client = await clientService.create(organizationId, userId, req.body);
      res.status(201).json({ success: true, client });
    } catch (err) { next(err); }
  },

  async updateClient(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const client = await clientService.update(organizationId, userId, req.params.clientId as string, req.body);
      res.json({ success: true, client });
    } catch (err) { next(err); }
  },

  async deleteClient(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      await clientService.remove(organizationId, userId, req.params.clientId as string);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // ── Campaigns ─────────────────────────────────────────────────────────
  async listCampaigns(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const campaigns = await campaignService.listForClient(organizationId, userId, req.params.clientId as string);
      res.json({ success: true, campaigns });
    } catch (err) { next(err); }
  },

  async getCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const campaign = await campaignService.get(organizationId, userId, req.params.campaignId as string);
      res.json({ success: true, campaign });
    } catch (err) { next(err); }
  },

  async createCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const campaign = await campaignService.create(organizationId, userId, req.params.clientId as string, req.body);
      res.status(201).json({ success: true, campaign });
    } catch (err) { next(err); }
  },

  async updateCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const campaign = await campaignService.update(organizationId, userId, req.params.campaignId as string, req.body);
      res.json({ success: true, campaign });
    } catch (err) { next(err); }
  },

  async deleteCampaign(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      await campaignService.remove(organizationId, userId, req.params.campaignId as string);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // ── Campaign people ───────────────────────────────────────────────────
  async listCampaignMembers(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const members = await campaignService.listMembers(organizationId, userId, req.params.campaignId as string);
      res.json({ success: true, members });
    } catch (err) { next(err); }
  },

  async addCampaignMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const member = await campaignService.addMember(organizationId, userId, req.params.campaignId as string, req.body);
      res.status(201).json({ success: true, member });
    } catch (err) { next(err); }
  },

  async removeCampaignMember(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      await campaignService.removeMember(organizationId, userId, req.params.campaignId as string, req.params.memberId as string);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  // ── Campaign assets ───────────────────────────────────────────────────
  async listCampaignAssets(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const assets = await campaignService.listAssets(organizationId, userId, req.params.campaignId as string);
      res.json({ success: true, assets });
    } catch (err) { next(err); }
  },

  async attachCampaignAsset(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const { assetId } = req.body as { assetId?: string };
      if (!assetId) throw new AppError(400, 'assetId is required');
      const result = await campaignService.attachAsset(organizationId, userId, req.params.campaignId as string, assetId);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  // ── Campaign activity ─────────────────────────────────────────────────
  async listCampaignActivity(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const activity = await campaignService.listActivity(organizationId, userId, req.params.campaignId as string);
      res.json({ success: true, activity });
    } catch (err) { next(err); }
  },

  // ── Business Overview summary ─────────────────────────────────────────
  async getOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const [clients, allCampaigns] = await Promise.all([
        clientService.list(organizationId, userId),
        (async () => {
          const { prisma } = await import('../../lib/prisma');
          return prisma.campaign.findMany({
            where: { organizationId },
            include: { _count: { select: { assets: true, members: true } }, client: { select: { name: true } } },
            orderBy: { updatedAt: 'desc' },
            take: 5,
          });
        })(),
      ]);
      const { prisma } = await import('../../lib/prisma');
      const [assetCount, creatorCount] = await Promise.all([
        prisma.asset.count({ where: { ownerUserId: userId, campaignId: { not: null } } }),
        prisma.campaignMember.count({ where: { campaign: { organizationId }, isExternal: true } }),
      ]);
      res.json({
        success: true,
        overview: {
          clientCount: clients.length,
          campaignCount: await prisma.campaign.count({ where: { organizationId } }),
          assetCount,
          creatorCount,
          recentClients: clients.slice(0, 5),
          recentCampaigns: allCampaigns.map((c) => ({
            id: c.id,
            name: c.name,
            clientName: c.client.name,
            assetCount: c._count.assets,
            memberCount: c._count.members,
            status: c.status,
          })),
        },
      });
    } catch (err) { next(err); }
  },
};
