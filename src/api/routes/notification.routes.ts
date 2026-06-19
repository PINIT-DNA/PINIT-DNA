import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { getNotifications, markRead, markAllRead, deleteNotification } from '../controllers/notification.controller';

const router = Router();

router.get('/',           requireAuth, getNotifications);
router.put('/read-all',   requireAuth, markAllRead);
router.put('/:id/read',   requireAuth, markRead);
router.delete('/:id',     requireAuth, deleteNotification);

export { router as notificationRouter };
