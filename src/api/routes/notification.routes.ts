import { Router } from 'express';
import { requireAuth, requireAuthSse } from '../middleware/auth.middleware';
import { getNotifications, markRead, markAllRead, archiveNotification, deleteNotification, streamNotifications } from '../controllers/notification.controller';

const router = Router();

router.get('/stream',       requireAuthSse, streamNotifications);
router.get('/',             requireAuth, getNotifications);
router.put('/read-all',   requireAuth, markAllRead);
router.put('/:id/read',   requireAuth, markRead);
router.put('/:id/archive', requireAuth, archiveNotification);
router.delete('/:id',     requireAuth, deleteNotification);

export { router as notificationRouter };
