import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getProfile, updateProfile, updateNotificationPrefs, changePassword,
  getProfileStats, getActivityTimeline, getSessions, revokeSession, revokeAllSessions,
  avatarUpload, uploadProfileAvatar, deleteProfileAvatar, getPublicAvatar,
} from '../controllers/profile.controller';
import {
  checkGovernmentIdFace,
  getGovernmentId,
  governmentIdUpload,
  sealGovernmentId,
} from '../controllers/government-id.controller';
import {
  analyzeIdentityDocuments,
  getLatestIdentityVerification,
  identityDocumentsUpload,
  MAX_DOCUMENTS,
} from '../controllers/identity-verification.controller';

const router = Router();

const governmentIdFaceLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env['NODE_ENV'] === 'production' ? 20 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many face checks. Wait a few minutes and try again.' },
});

// OCR and image analysis are expensive; keep analysis bursts small.
const identityAnalyzeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env['NODE_ENV'] === 'production' ? 10 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many identity checks. Wait a few minutes and try again.' },
});

router.get('/avatar/:shortId', getPublicAvatar);
router.post(
  '/identity-verification/analyze',
  requireAuth,
  identityAnalyzeLimiter,
  identityDocumentsUpload.array('documents', MAX_DOCUMENTS),
  analyzeIdentityDocuments,
);
router.get('/identity-verification/latest', requireAuth, getLatestIdentityVerification);
router.get('/government-id', requireAuth, getGovernmentId);
router.post('/government-id/face-check', requireAuth, governmentIdFaceLimiter, checkGovernmentIdFace);
router.post('/government-id', requireAuth, governmentIdUpload.single('document'), sealGovernmentId);
router.post('/avatar',         requireAuth, avatarUpload.single('avatar'), uploadProfileAvatar);
router.delete('/avatar',       requireAuth, deleteProfileAvatar);
router.get('/',              requireAuth, getProfile);
router.put('/',              requireAuth, updateProfile);
router.put('/notifications', requireAuth, updateNotificationPrefs);
router.put('/password',      requireAuth, changePassword);
router.get('/stats',         requireAuth, getProfileStats);
router.get('/activity',      requireAuth, getActivityTimeline);
router.get('/sessions',      requireAuth, getSessions);
router.delete('/session/:id', requireAuth, revokeSession);
router.delete('/sessions',   requireAuth, revokeAllSessions);

export { router as profileRouter };
