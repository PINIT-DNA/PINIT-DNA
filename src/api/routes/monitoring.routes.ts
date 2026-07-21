import { Router } from 'express';
import {
  enrollMonitor, listMonitors, runCheckNow,
  getAlerts, dismissAlert, confirmAlert,
  getMonitoringStats, pauseMonitor, resumeMonitor, stopMonitor,
  getMonitorRuns, updateScanType, enrollAll, updateWatchUrls, getEngineStats,
} from '../controllers/monitoring.controller';
import { requireAuth } from '../middleware/auth.middleware';
import {
  requireMonitorOwnership,
  requireDnaOwnership,
  requireAlertOwnership,
} from '../middleware/ownership.middleware';
import { requireFeature, FeatureKey } from '../../services/subscription';

const router = Router();
const requireTracking = requireFeature(FeatureKey.FEATURE_TRACKING);

router.get('/stats',                  requireAuth, requireTracking, getMonitoringStats);
router.get('/engine/stats',           requireAuth, requireTracking, getEngineStats);
router.post('/enroll-all',            requireAuth, requireTracking, enrollAll);
router.get('/',                       requireAuth, requireTracking, listMonitors);
router.post('/enroll/:dnaRecordId',   requireAuth, requireTracking, requireDnaOwnership, enrollMonitor);
router.get('/alerts',                 requireAuth, requireTracking, getAlerts);
router.post('/alerts/:id/dismiss',    requireAuth, requireTracking, requireAlertOwnership, dismissAlert);
router.post('/alerts/:id/confirm',    requireAuth, requireTracking, requireAlertOwnership, confirmAlert);
router.post('/:id/check',             requireAuth, requireTracking, requireMonitorOwnership, runCheckNow);
router.get('/:id/runs',               requireAuth, requireTracking, requireMonitorOwnership, getMonitorRuns);
router.patch('/:id/scan-type',        requireAuth, requireTracking, requireMonitorOwnership, updateScanType);
router.patch('/:id/watch-urls',       requireAuth, requireTracking, requireMonitorOwnership, updateWatchUrls);
router.post('/:id/pause',             requireAuth, requireTracking, requireMonitorOwnership, pauseMonitor);
router.post('/:id/resume',            requireAuth, requireTracking, requireMonitorOwnership, resumeMonitor);
router.delete('/:id',                 requireAuth, requireTracking, requireMonitorOwnership, stopMonitor);

export { router as monitoringRouter };
