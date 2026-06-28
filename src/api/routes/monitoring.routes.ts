import { Router } from 'express';
import {
  enrollMonitor, listMonitors, runCheckNow,
  getAlerts, dismissAlert, confirmAlert,
  getMonitoringStats, pauseMonitor, resumeMonitor, stopMonitor,
  getMonitorRuns, updateScanType, enrollAll, updateWatchUrls,
} from '../controllers/monitoring.controller';
import { requireAuth } from '../middleware/auth.middleware';
import {
  requireMonitorOwnership,
  requireDnaOwnership,
  requireAlertOwnership,
} from '../middleware/ownership.middleware';

const router = Router();

router.get('/stats',                  requireAuth, getMonitoringStats);
router.post('/enroll-all',            requireAuth, enrollAll);
router.get('/',                       requireAuth, listMonitors);
router.post('/enroll/:dnaRecordId',   requireAuth, requireDnaOwnership, enrollMonitor);
router.get('/alerts',                 requireAuth, getAlerts);
router.post('/alerts/:id/dismiss',    requireAuth, requireAlertOwnership, dismissAlert);
router.post('/alerts/:id/confirm',    requireAuth, requireAlertOwnership, confirmAlert);
router.post('/:id/check',             requireAuth, requireMonitorOwnership, runCheckNow);
router.get('/:id/runs',               requireAuth, requireMonitorOwnership, getMonitorRuns);
router.patch('/:id/scan-type',        requireAuth, requireMonitorOwnership, updateScanType);
router.patch('/:id/watch-urls',       requireAuth, requireMonitorOwnership, updateWatchUrls);
router.post('/:id/pause',             requireAuth, requireMonitorOwnership, pauseMonitor);
router.post('/:id/resume',            requireAuth, requireMonitorOwnership, resumeMonitor);
router.delete('/:id',                 requireAuth, requireMonitorOwnership, stopMonitor);

export { router as monitoringRouter };
