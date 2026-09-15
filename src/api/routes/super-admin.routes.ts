/**
 * Super Admin Console routes — SUPER_ADMIN only.
 * Separate from /admin (legacy ADMIN portal).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireSuperAdmin, requireCapability } from '../middleware/role.middleware';
import { auditAdminMutations } from '../middleware/admin-audit.middleware';
import {
  getMyCapabilities,
  getCommandCenterSummary,
  globalSearch,
  listAllOrganizations,
  getOrganizationProfile,
  getExecutiveOverview,
  getSystemHealth,
  listAllUsers,
  getUserProfile,
  listAllVault,
  listAllFiles,
  listAllDna,
  listAllCertificates,
  listInvestigations,
  listTrackingEvents,
  listMonitoring,
  getAnalytics,
  getRecentActivity,
  getAuditLogs,
  getAdminAuditLog,
  updateUserRole,
  toggleUserActive,
  revokeSession,
  untrustDevice,
  signOutEverywhere,
  getAdminVaultIntelligence,
  getAdminVaultTracking,
  getAdminVaultShares,
  getAdminVaultTimeline,
  getBillingOverview,
  listNotifications,
  listIncidents,
  getIncidentDetail,
  listBiometricIdentities,
  getRbacMatrix,
  getPlatformSummaryReport,
  listVerificationRequests,
  createVerificationRequest,
  reviewVerificationRequest,
  listSupportTickets,
  getSupportTicketDetail,
  createSupportTicket,
  addSupportTicketMessage,
  resolveSupportTicket,
  getNetworkOverview,
  getUsageOverview,
} from '../controllers/super-admin.controller';
import { uploadInvestigation } from '../middleware/upload.middleware';
import { unifiedInvestigate } from '../controllers/unified-investigation.controller';

const router = Router();

// Authenticated + active only below this line. Read access per-route is
// gated by capability domain (see src/config/admin-capabilities.ts) — the
// hardcoded platform-owner allowlist is reserved for destructive routes.
router.use(requireAuth, auditAdminMutations);

router.get('/me', getMyCapabilities);

router.get('/command-center', requireCapability('overview'), getCommandCenterSummary);
router.get('/search', requireCapability('overview'), globalSearch);
router.get('/overview', requireCapability('overview'), getExecutiveOverview);
router.get('/health', requireCapability('overview'), getSystemHealth);
router.get('/rbac-matrix', requireCapability('system'), getRbacMatrix);
router.get('/activity', requireCapability('overview'), getRecentActivity);

router.get('/organizations', requireCapability('identity'), listAllOrganizations);
router.get('/organizations/:id', requireCapability('identity'), getOrganizationProfile);

router.get('/biometric-identities', requireCapability('identity'), listBiometricIdentities);
router.get('/verification-requests', requireCapability('identity'), listVerificationRequests);
router.post('/verification-requests', requireCapability('identity'), createVerificationRequest);
router.post('/verification-requests/:id/review', requireSuperAdmin, reviewVerificationRequest);
router.get('/users', requireCapability('identity'), listAllUsers);
router.get('/users/:id', requireCapability('identity'), getUserProfile);
router.post('/users/:id/role', requireSuperAdmin, updateUserRole);
router.post('/users/:id/toggle', requireSuperAdmin, toggleUserActive);
router.post('/users/:id/sign-out-everywhere', requireSuperAdmin, signOutEverywhere);
router.post('/sessions/:id/revoke', requireSuperAdmin, revokeSession);
router.post('/devices/:id/untrust', requireSuperAdmin, untrustDevice);

router.get('/vault', requireCapability('assets'), listAllVault);
router.get('/vault/:id/intelligence', requireCapability('assets'), getAdminVaultIntelligence);
router.get('/vault/:id/tracking', requireCapability('assets'), getAdminVaultTracking);
router.get('/vault/:id/shares', requireCapability('assets'), getAdminVaultShares);
router.get('/vault/:id/timeline', requireCapability('assets'), getAdminVaultTimeline);
router.get('/files', requireCapability('assets'), listAllFiles);
router.get('/dna', requireCapability('assets'), listAllDna);
router.get('/certificates', requireCapability('assets'), listAllCertificates);

router.get('/investigations', requireCapability('forensics'), listInvestigations);
router.get('/incidents', requireCapability('forensics'), listIncidents);
router.get('/incidents/:id', requireCapability('forensics'), getIncidentDetail);
router.get('/tracking', requireCapability('forensics'), listTrackingEvents);
router.post('/unified-investigate', requireCapability('forensics'), uploadInvestigation, unifiedInvestigate);

router.get('/monitoring', requireCapability('operations'), listMonitoring);

router.get('/billing', requireCapability('commerce'), getBillingOverview);
router.get('/usage-overview', requireCapability('commerce'), getUsageOverview);
router.get('/notifications', requireCapability('overview'), listNotifications);

router.get('/network-overview', requireCapability('intelligence'), getNetworkOverview);
router.get('/analytics', requireCapability('intelligence'), getAnalytics);
router.get('/reports/platform-summary', requireCapability('intelligence'), getPlatformSummaryReport);
router.get('/audit', requireCapability('intelligence'), getAuditLogs);
router.get('/admin-audit', requireCapability('intelligence'), getAdminAuditLog);

router.get('/support-tickets', requireCapability('system'), listSupportTickets);
router.get('/support-tickets/:id', requireCapability('system'), getSupportTicketDetail);
router.post('/support-tickets', requireCapability('system'), createSupportTicket);
router.post('/support-tickets/:id/messages', requireCapability('system'), addSupportTicketMessage);
router.post('/support-tickets/:id/resolve', requireCapability('system'), resolveSupportTicket);

export { router as superAdminRouter };
