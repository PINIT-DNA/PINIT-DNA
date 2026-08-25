import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { businessController } from '../controllers/business.controller';

export const businessRouter = Router();

businessRouter.get('/overview', requireAuth, businessController.getOverview);

businessRouter.get('/clients', requireAuth, businessController.listClients);
businessRouter.post('/clients', requireAuth, businessController.createClient);
businessRouter.get('/clients/:clientId', requireAuth, businessController.getClient);
businessRouter.patch('/clients/:clientId', requireAuth, businessController.updateClient);
businessRouter.delete('/clients/:clientId', requireAuth, businessController.deleteClient);

businessRouter.get('/clients/:clientId/campaigns', requireAuth, businessController.listCampaigns);
businessRouter.post('/clients/:clientId/campaigns', requireAuth, businessController.createCampaign);

businessRouter.get('/campaigns/:campaignId', requireAuth, businessController.getCampaign);
businessRouter.patch('/campaigns/:campaignId', requireAuth, businessController.updateCampaign);
businessRouter.delete('/campaigns/:campaignId', requireAuth, businessController.deleteCampaign);

businessRouter.get('/campaigns/:campaignId/members', requireAuth, businessController.listCampaignMembers);
businessRouter.post('/campaigns/:campaignId/members', requireAuth, businessController.addCampaignMember);
businessRouter.delete('/campaigns/:campaignId/members/:memberId', requireAuth, businessController.removeCampaignMember);

businessRouter.get('/campaigns/:campaignId/assets', requireAuth, businessController.listCampaignAssets);
businessRouter.post('/campaigns/:campaignId/assets', requireAuth, businessController.attachCampaignAsset);

businessRouter.get('/campaigns/:campaignId/activity', requireAuth, businessController.listCampaignActivity);

// ── Asset versions — immutable revision chain (V1 → V2 → V3) ────────────────
businessRouter.get('/assets/:assetId/versions', requireAuth, businessController.listAssetVersions);
businessRouter.post('/assets/:assetId/versions', requireAuth, businessController.createAssetVersion);
businessRouter.get('/versions/:versionId', requireAuth, businessController.getAssetVersion);
businessRouter.patch('/versions/:versionId/review-status', requireAuth, businessController.setVersionReviewStatus);

// ── Review comments and change requests — always version-anchored ───────────
businessRouter.get('/versions/:versionId/comments', requireAuth, businessController.listVersionComments);
businessRouter.post('/versions/:versionId/comments', requireAuth, businessController.createVersionComment);
businessRouter.patch('/comments/:commentId/status', requireAuth, businessController.setCommentStatus);
businessRouter.get('/campaigns/:campaignId/change-requests', requireAuth, businessController.listCampaignChangeRequests);

// ── Version approvals — insert-only decisions with identity evidence ────────
businessRouter.post('/versions/:versionId/decision', requireAuth, businessController.decideVersion);
businessRouter.get('/versions/:versionId/approvals', requireAuth, businessController.listVersionApprovals);
businessRouter.get('/campaigns/:campaignId/approvals', requireAuth, businessController.listCampaignApprovals);
