import type { Request, Response, NextFunction } from 'express';
import type { CommentKind, CommentStatus } from '@prisma/client';
import { getAuthUserId } from '../../lib/tenant-scope';
import { getOrganizationIdForUser } from '../../services/organization/org-access.service';
import { clientService } from '../../services/organization/client.service';
import { campaignService } from '../../services/organization/campaign.service';
import { assetVersionService } from '../../services/organization/asset-version.service';
import { reviewCommentService } from '../../services/organization/review-comment.service';
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

  // ── Review comments / change requests ─────────────────────────────────
  async listVersionComments(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const { status, kind } = req.query as { status?: string; kind?: string };
      const result = await reviewCommentService.listForVersion(
        organizationId, userId, req.params.versionId as string,
        {
          ...(status ? { status: status as CommentStatus } : {}),
          ...(kind ? { kind: kind as CommentKind } : {}),
        },
      );
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  async createVersionComment(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const comment = await reviewCommentService.create(
        organizationId, userId, req.params.versionId as string, req.body,
      );
      res.status(201).json({ success: true, comment });
    } catch (err) { next(err); }
  },

  async setCommentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const { status } = (req.body ?? {}) as { status?: string };
      if (!status) throw new AppError(400, 'A status is required');
      const comment = await reviewCommentService.setStatus(
        organizationId, userId, req.params.commentId as string,
        status as Parameters<typeof reviewCommentService.setStatus>[3],
      );
      res.json({ success: true, comment });
    } catch (err) { next(err); }
  },

  async listCampaignChangeRequests(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const changeRequests = await reviewCommentService.listOpenChangeRequests(
        organizationId, userId, req.params.campaignId as string,
      );
      res.json({ success: true, changeRequests });
    } catch (err) { next(err); }
  },

  // ── Asset versions ────────────────────────────────────────────────────
  async listAssetVersions(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const result = await assetVersionService.list(organizationId, userId, req.params.assetId as string);
      res.json({ success: true, ...result });
    } catch (err) { next(err); }
  },

  async createAssetVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const version = await assetVersionService.createVersion(
        organizationId, userId, req.params.assetId as string, req.body,
      );
      res.status(201).json({ success: true, version });
    } catch (err) { next(err); }
  },

  async getAssetVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const version = await assetVersionService.get(organizationId, userId, req.params.versionId as string);
      res.json({ success: true, version });
    } catch (err) { next(err); }
  },

  async setVersionReviewStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, organizationId } = await orgIdFor(req);
      const { status, note } = (req.body ?? {}) as { status?: string; note?: string };
      if (!status) throw new AppError(400, 'A review status is required');
      const version = await assetVersionService.setReviewStatus(
        organizationId, userId, req.params.versionId as string,
        status as Parameters<typeof assetVersionService.setReviewStatus>[3],
        { note },
      );
      res.json({ success: true, version });
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
