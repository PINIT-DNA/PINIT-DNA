import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
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
} from '../controllers/share-link.controller';

export const shareRouter = Router();

// ── Fixed-path routes FIRST (must precede the /:token wildcard below) ────────
shareRouter.post('/',                          requireAuth, createShareLink);
shareRouter.get('/',                           requireAuth, listShareLinks);
shareRouter.get('/vault/:vaultId',             requireAuth, getVaultShareLinks);
shareRouter.get('/timeline/:dnaId',            requireAuth, getShareTimeline);
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
shareRouter.get('/:token/masked-text',         getMaskedText);            // ── Privacy Masking — masked content
shareRouter.post('/:token/unmask-request',     requestUnmask);            // ── Privacy Masking — request access
shareRouter.get('/:token/unmask-status',       getUnmaskStatus);          // ── Privacy Masking — check approval

// Owner-only routes (require auth)
shareRouter.get('/:token/logs',                requireAuth, getShareLinkLogs);
shareRouter.get('/:token/export',              requireAuth, exportShareLogsCsv);
shareRouter.delete('/:token',                  requireAuth, revokeShareLink);
shareRouter.post('/:token/force-logout',       requireAuth, forceLogoutLink);
