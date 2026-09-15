import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import {
  getProfile, updateProfile, updateNotificationPrefs, changePassword,
  getProfileStats, getActivityTimeline, getSessions, revokeSession, revokeAllSessions,
  avatarUpload, uploadProfileAvatar, deleteProfileAvatar, getPublicAvatar,
} from '../controllers/profile.controller';

const router = Router();

router.get('/avatar/:shortId', getPublicAvatar);
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
