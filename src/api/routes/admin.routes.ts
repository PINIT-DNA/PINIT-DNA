import { Router } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { requireAdmin, getStats, getUsers, getUserDetail, getAllVaultFiles, getActivity, updateUserRole, toggleUser } from '../controllers/admin.controller';

const router = Router();

router.use(requireAuth);
router.use(requireAdmin);

router.get('/stats', getStats);
router.get('/users', getUsers);
router.get('/users/:id', getUserDetail);
router.get('/vault', getAllVaultFiles);
router.get('/activity', getActivity);
router.post('/users/:id/role', updateUserRole);
router.post('/users/:id/toggle', toggleUser);

export { router as adminRouter };
