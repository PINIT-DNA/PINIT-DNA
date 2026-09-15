import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { organizationController, orgLogoUpload } from '../controllers/organization.controller';

export const organizationRouter = Router();

organizationRouter.get('/me', requireAuth, organizationController.getMine);
organizationRouter.post('/setup', requireAuth, organizationController.completeSetup);
organizationRouter.patch('/profile', requireAuth, organizationController.updateProfile);
organizationRouter.post('/logo', requireAuth, orgLogoUpload.single('logo'), organizationController.uploadLogo);
organizationRouter.post('/welcome/skip', requireAuth, organizationController.skipWelcome);
organizationRouter.get('/billing', requireAuth, organizationController.getBillingSummary);

organizationRouter.get('/team', requireAuth, organizationController.getTeam);
organizationRouter.get('/team/members', requireAuth, organizationController.listMembers);
organizationRouter.get('/team/invites', requireAuth, organizationController.listInvites);
organizationRouter.post('/team/invite', requireAuth, organizationController.inviteMember);
organizationRouter.get('/team/invites/preview/:token', requireAuth, organizationController.previewInvite);
organizationRouter.post('/team/accept', requireAuth, organizationController.acceptInvite);
// Confirm a Pinit account exists before inviting it — name only, nothing more.
organizationRouter.get('/team/lookup-pinit-id', requireAuth, organizationController.lookupPinitId);
organizationRouter.delete('/team/invites/:id', requireAuth, organizationController.revokeInvite);
organizationRouter.patch('/team/members/:id/role', requireAuth, organizationController.updateMemberRole);
organizationRouter.delete('/team/members/:id', requireAuth, organizationController.removeMember);

organizationRouter.get('/workspaces', requireAuth, organizationController.listWorkspaces);
organizationRouter.post('/workspaces', requireAuth, organizationController.createWorkspace);

organizationRouter.get('/departments', requireAuth, organizationController.listDepartments);
organizationRouter.post('/departments', requireAuth, organizationController.createDepartment);
organizationRouter.patch('/departments/:id', requireAuth, organizationController.updateDepartment);
organizationRouter.delete('/departments/:id', requireAuth, organizationController.deleteDepartment);

organizationRouter.get('/audit-logs', requireAuth, organizationController.listAuditLogs);

organizationRouter.get('/api-keys', requireAuth, organizationController.listApiKeys);
organizationRouter.post('/api-keys', requireAuth, organizationController.createApiKey);
organizationRouter.delete('/api-keys/:id', requireAuth, organizationController.revokeApiKey);

organizationRouter.get('/webhooks', requireAuth, organizationController.listWebhooks);
organizationRouter.post('/webhooks', requireAuth, organizationController.createWebhook);
organizationRouter.patch('/webhooks/:id', requireAuth, organizationController.updateWebhook);
organizationRouter.delete('/webhooks/:id', requireAuth, organizationController.deleteWebhook);
organizationRouter.post('/webhooks/:id/test', requireAuth, organizationController.testWebhook);

organizationRouter.get('/integrations', requireAuth, organizationController.listIntegrations);
organizationRouter.post('/integrations/slack', requireAuth, organizationController.connectSlack);
organizationRouter.post('/integrations/slack/test', requireAuth, organizationController.testSlack);
organizationRouter.post('/integrations/teams', requireAuth, organizationController.connectTeams);
organizationRouter.post('/integrations/teams/test', requireAuth, organizationController.testTeams);
organizationRouter.post('/integrations/zapier', requireAuth, organizationController.connectZapier);
organizationRouter.post('/integrations/zapier/test', requireAuth, organizationController.testZapier);
organizationRouter.post('/integrations/dropbox', requireAuth, organizationController.connectDropbox);
organizationRouter.post('/integrations/dropbox/test', requireAuth, organizationController.testDropbox);
organizationRouter.post('/integrations/google-drive', requireAuth, organizationController.connectGoogleDrive);
organizationRouter.post('/integrations/google-drive/test', requireAuth, organizationController.testGoogleDrive);
organizationRouter.delete('/integrations/:provider', requireAuth, organizationController.disconnectIntegration);
