/**
 * Super Admin Console routes — SUPER_ADMIN only.
 * Separate from /admin (legacy ADMIN portal).
 */
import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireSuperAdmin } from '../middleware/role.middleware';
import {
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
  updateUserRole,
  toggleUserActive,
  getAdminVaultIntelligence,
  getAdminVaultTracking,
  getAdminVaultShares,
  getAdminVaultTimeline,
} from '../controllers/super-admin.controller';
import { uploadSingle } from '../middleware/upload.middleware';
import { unifiedInvestigate } from '../controllers/unified-investigation.controller';

const router = Router();

router.use(requireAuth, requireSuperAdmin);

router.get('/overview', getExecutiveOverview);
router.get('/health', getSystemHealth);
router.get('/users', listAllUsers);
router.get('/users/:id', getUserProfile);
router.post('/users/:id/role', updateUserRole);
router.post('/users/:id/toggle', toggleUserActive);
router.get('/vault', listAllVault);
router.get('/vault/:id/intelligence', getAdminVaultIntelligence);
router.get('/vault/:id/tracking', getAdminVaultTracking);
router.get('/vault/:id/shares', getAdminVaultShares);
router.get('/vault/:id/timeline', getAdminVaultTimeline);
router.get('/files', listAllFiles);
router.get('/dna', listAllDna);
router.get('/certificates', listAllCertificates);
router.get('/investigations', listInvestigations);
router.get('/tracking', listTrackingEvents);
router.get('/monitoring', listMonitoring);
router.get('/analytics', getAnalytics);
router.get('/activity', getRecentActivity);
router.get('/audit', getAuditLogs);
router.post('/unified-investigate', uploadSingle, unifiedInvestigate);

export { router as superAdminRouter };
