import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { clientReportController } from '../controllers/client-report.controller';
import {
  requireShareLinkOwnership,
  requireVaultOwnership,
  requireDnaOwnership,
} from '../middleware/ownership.middleware';
import { requireFeature, FeatureKey } from '../../services/subscription';
import {
  createShareLink,
  createFileShare,
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
  postShareViewerMessage,
  listShareViewerMessages,
  replyShareViewerMessage,
  getMyShareViewerMessages,
  getShareReview,
  getShareReviewComments,
  postShareReviewComment,
  postShareReviewDecision,
  getShareReviewDecisions,
  getShareMessages,
  postShareMessage,
  markShareMessagesRead,
  streamShareMessages,
  getHandoverView,
  debugReport,
  getGlobalShareStats,
  getLiveTrackingMap,
  attributeLeakedFile,
  leakUploadMiddleware,
  getLinkTree,
  shareFurther,
  previewImage,
  requireTrackingUnlessLicensedShare,
} from '../controllers/share-link.controller';

export const shareRouter = Router();

// ── Fixed-path routes FIRST (must precede the /:token wildcard below) ────────
shareRouter.post('/',                          requireAuth, requireFeature(FeatureKey.FEATURE_SMART_SHARE), createShareLink);
shareRouter.post('/file',                      requireAuth, requireFeature(FeatureKey.FEATURE_SMART_SHARE), createFileShare);
shareRouter.get('/',                           requireAuth, listShareLinks);
shareRouter.get('/vault/:vaultId',             requireAuth, requireVaultOwnership, getVaultShareLinks);
shareRouter.get('/timeline/:dnaId',            requireAuth, requireDnaOwnership, getShareTimeline);
shareRouter.get('/analytics/geo',              requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), getGeoAnalytics);
shareRouter.get('/analytics/global',           requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), getGlobalShareStats);
shareRouter.get('/analytics/live-map',         requireAuth, requireFeature(FeatureKey.FEATURE_TRACKING), getLiveTrackingMap);
shareRouter.post('/forensics/attribute-leak', requireAuth, requireFeature(FeatureKey.FEATURE_INVESTIGATION), leakUploadMiddleware, attributeLeakedFile);
shareRouter.get('/sessions/live',              requireAuth, getLiveSessions);
shareRouter.get('/debug/report',               requireAuth, debugReport);              // ── Diagnostic: URL + IP test report
shareRouter.get('/unmask-requests',            requireAuth, listUnmaskRequests);       // ── Privacy Masking — owner dashboard
shareRouter.post('/unmask-requests/:id/review', requireAuth, reviewUnmaskRequest);    // ── Privacy Masking — approve / reject
shareRouter.get('/messages',                   requireAuth, listShareViewerMessages);
shareRouter.post('/messages/:id/reply',        requireAuth, replyShareViewerMessage);

// ── Token-scoped routes ───────────────────────────────────────────────────────
// Public routes (no auth — accessed by recipients without accounts)
shareRouter.get('/:token',                     getShareLinkInfo);
shareRouter.post('/:token/access',             recordAccess);
shareRouter.post('/:token/share-further',      shareFurther);
shareRouter.post('/:token/verify-otp',         verifyShareOtp);
shareRouter.get('/:token/file',                serveSharedFile);
shareRouter.get('/:token/preview.png',         previewImage);              // ── Trackable OG preview image
shareRouter.get('/:token/masked-text',         getMaskedText);            // ── Privacy Masking — masked content
shareRouter.post('/:token/unmask-request',     requestUnmask);            // ── Privacy Masking — request access
shareRouter.get('/:token/unmask-status',       getUnmaskStatus);          // ── Privacy Masking — check approval
shareRouter.post('/:token/messages',           postShareViewerMessage);
shareRouter.get('/:token/messages/mine',       getMyShareViewerMessages);

// ── Client review — token-scoped, no account. Gated by the link's own flags. ─
shareRouter.get('/:token/review',              getShareReview);
shareRouter.get('/:token/review/comments',     getShareReviewComments);
shareRouter.post('/:token/review/comments',    postShareReviewComment);
shareRouter.get('/:token/review/decisions',    getShareReviewDecisions);
shareRouter.post('/:token/review/decision',    postShareReviewDecision);

// ── Campaign conversation — token-scoped, no account ────────────────────────
shareRouter.get('/:token/messages/stream',     streamShareMessages);
shareRouter.get('/:token/campaign-messages',   getShareMessages);
shareRouter.post('/:token/campaign-messages',  postShareMessage);
shareRouter.post('/:token/campaign-messages/read', markShareMessagesRead);

// ── Client handover bundle — token-scoped, no account ──────────────────────
shareRouter.get('/handover/:token',            getHandoverView);

// ── Client report — token-scoped, no account (Phase C, layer 6) ────────────
// Two literal segments, so neither can be shadowed by the '/:token/...' routes.
shareRouter.get('/client-report/:token',        clientReportController.getClientReport);
shareRouter.get('/client-report/:token/pdf',    clientReportController.downloadClientReport);
// Owner-only routes (require auth)
shareRouter.get('/:token/logs',                requireAuth, requireTrackingUnlessLicensedShare(requireFeature(FeatureKey.FEATURE_TRACKING)), requireShareLinkOwnership, getShareLinkLogs);
shareRouter.get('/:token/export',              requireAuth, requireShareLinkOwnership, exportShareLogsCsv);
shareRouter.delete('/:token',                  requireAuth, requireShareLinkOwnership, revokeShareLink);
shareRouter.post('/:token/block-viewer',       requireAuth, requireShareLinkOwnership, blockShareViewer);
shareRouter.delete('/:token/block-viewer/:blockId', requireAuth, requireShareLinkOwnership, unblockShareViewer);
shareRouter.post('/:token/force-logout',       requireAuth, requireShareLinkOwnership, forceLogoutLink);
shareRouter.get('/:token/tree',                requireAuth, requireShareLinkOwnership, getLinkTree);
