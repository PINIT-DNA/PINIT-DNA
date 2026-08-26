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

// ── Share dialog: may this file be shared for review? ───────────────────────
businessRouter.get('/share-eligibility/:vaultId', requireAuth, businessController.getShareReviewEligibility);

// ── Campaign conversation — client ↔ team, scoped to one campaign ───────────
businessRouter.get('/campaigns/:campaignId/messages', requireAuth, businessController.listCampaignMessages);
businessRouter.post('/campaigns/:campaignId/messages', requireAuth, businessController.sendCampaignMessage);
businessRouter.post('/campaigns/:campaignId/messages/read', requireAuth, businessController.markCampaignMessagesRead);
businessRouter.get('/campaigns/:campaignId/messages/stream', requireAuth, businessController.streamCampaignMessages);
businessRouter.get('/messages/unread', requireAuth, businessController.getCampaignUnread);

// ── Campaign people — scoped access for external creators ───────────────────
// Internal membership stays with the organization team endpoints; nothing here
// grants Business Account access.
businessRouter.get('/campaigns/:campaignId/people', requireAuth, businessController.listCampaignPeople);
businessRouter.post('/campaigns/:campaignId/people/:memberId/access', requireAuth, businessController.grantCampaignAccess);
businessRouter.patch('/campaigns/:campaignId/people/:memberId/access', requireAuth, businessController.updateCampaignAccess);
businessRouter.delete('/campaigns/:campaignId/people/:memberId/access', requireAuth, businessController.revokeCampaignAccess);
businessRouter.get('/campaigns/:campaignId/people/:memberId/links', requireAuth, businessController.listCampaignAccessLinks);

// ── Rights — Exchange remains the source of truth; this only presents it ────
businessRouter.get('/campaigns/:campaignId/rights', requireAuth, businessController.listCampaignRights);

// ── Client handover — only approved versions, scoped links, revocable ───────
businessRouter.get('/campaigns/:campaignId/handover/candidates', requireAuth, businessController.listHandoverCandidates);
businessRouter.get('/campaigns/:campaignId/handovers', requireAuth, businessController.listHandovers);
businessRouter.post('/campaigns/:campaignId/handovers', requireAuth, businessController.createHandover);
businessRouter.post('/campaigns/:campaignId/handovers/:handoverId/send', requireAuth, businessController.sendHandover);
businessRouter.delete('/campaigns/:campaignId/handovers/:handoverId', requireAuth, businessController.revokeHandover);

// ── Monitoring — scopes the existing monitor engine to a campaign ───────────
// No new crawler, DNA or finding store; monitoringService already owns those.
businessRouter.get('/campaigns/:campaignId/monitoring', requireAuth, businessController.listCampaignMonitoring);
businessRouter.post('/campaigns/:campaignId/monitoring/:assetId', requireAuth, businessController.enableCampaignMonitoring);
businessRouter.delete('/campaigns/:campaignId/monitoring/:assetId', requireAuth, businessController.disableCampaignMonitoring);
