import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  requireShareLinkOwnership,
  requireVaultOwnership,
  requireDnaOwnership,
} from '../middleware/ownership.middleware';
import {
  createShareLink,
  listShareLinks,
  getShareLinkInfo,
  getShareLinkLogs,
  recordAccess,
  serveSharedFile,
  getVaultShareLinks,
  getShareTimeline,
  revokeShareLink,
  blockShareViewer,
  unblockShareViewer,
  verifyShareOtp,
  getGeoAnalytics,
  exportShareLogsCsv,
  getLiveSessions,
  forceLogoutLink,
  getMaskedText,
  requestUnmask,
  getUnmaskStatus,
  listUnmaskRequests,
  reviewUnmaskRequest,
  debugReport,
  getGlobalShareStats,
  attributeLeakedFile,
  leakUploadMiddleware,
  getLinkTree,
  previewImage,
} from '../controllers/share-link.controller';

export const shareRouter = Router();

// ── Fixed-path routes FIRST (must precede the /:token wildcard below) ────────
shareRouter.post('/',                          requireAuth, createShareLink);
shareRouter.get('/',                           requireAuth, listShareLinks);
shareRouter.get('/vault/:vaultId',             requireAuth, requireVaultOwnership, getVaultShareLinks);
shareRouter.get('/timeline/:dnaId',            requireAuth, requireDnaOwnership, getShareTimeline);
shareRouter.get('/analytics/geo',              requireAuth, getGeoAnalytics);
shareRouter.get('/analytics/global',           requireAuth, getGlobalShareStats);
shareRouter.post('/forensics/attribute-leak', requireAuth, leakUploadMiddleware, attributeLeakedFile);
shareRouter.get('/sessions/live',              requireAuth, getLiveSessions);
shareRouter.get('/debug/report',               requireAuth, debugReport);              // ── Diagnostic: URL + IP test report
shareRouter.get('/unmask-requests',            requireAuth, listUnmaskRequests);       // ── Privacy Masking — owner dashboard
shareRouter.post('/unmask-requests/:id/review', requireAuth, reviewUnmaskRequest);    // ── Privacy Masking — approve / reject

// ── Token-scoped routes ───────────────────────────────────────────────────────
// Public routes (no auth — accessed by recipients without accounts)
shareRouter.get('/:token',                     getShareLinkInfo);
shareRouter.post('/:token/access',             recordAccess);
shareRouter.post('/:token/verify-otp',         verifyShareOtp);
shareRouter.get('/:token/file',                serveSharedFile);
shareRouter.get('/:token/preview.png',         previewImage);              // ── Trackable OG preview image
shareRouter.get('/:token/masked-text',         getMaskedText);            // ── Privacy Masking — masked content
shareRouter.post('/:token/unmask-request',     requestUnmask);            // ── Privacy Masking — request access
shareRouter.get('/:token/unmask-status',       getUnmaskStatus);          // ── Privacy Masking — check approval

// Owner-only routes (require auth)
shareRouter.get('/:token/logs',                requireAuth, requireShareLinkOwnership, getShareLinkLogs);
shareRouter.get('/:token/export',              requireAuth, requireShareLinkOwnership, exportShareLogsCsv);
shareRouter.delete('/:token',                  requireAuth, requireShareLinkOwnership, revokeShareLink);
shareRouter.post('/:token/block-viewer',       requireAuth, requireShareLinkOwnership, blockShareViewer);
shareRouter.delete('/:token/block-viewer/:blockId', requireAuth, requireShareLinkOwnership, unblockShareViewer);
shareRouter.post('/:token/force-logout',       requireAuth, requireShareLinkOwnership, forceLogoutLink);
shareRouter.get('/:token/tree',                requireAuth, requireShareLinkOwnership, getLinkTree);
