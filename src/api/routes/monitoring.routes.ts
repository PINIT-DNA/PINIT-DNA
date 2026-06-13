import { Router } from 'express';
import {
  enrollMonitor, listMonitors, runCheckNow,
  getAlerts, dismissAlert, confirmAlert,
  getMonitoringStats, pauseMonitor, resumeMonitor, stopMonitor,
  getMonitorRuns, updateScanType, enrollAll, updateWatchUrls,
} from '../controllers/monitoring.controller';
import { requireAuth } from '../middleware/auth.middleware';

const router = Router();

router.get('/stats',                  requireAuth, getMonitoringStats);
router.post('/enroll-all',            requireAuth, enrollAll);
router.get('/',                       requireAuth, listMonitors);
router.post('/enroll/:dnaRecordId',   requireAuth, enrollMonitor);
router.get('/alerts',                 requireAuth, getAlerts);
router.post('/alerts/:id/dismiss',    requireAuth, dismissAlert);
router.post('/alerts/:id/confirm',    requireAuth, confirmAlert);
router.post('/:id/check',             requireAuth, runCheckNow);
router.get('/:id/runs',               requireAuth, getMonitorRuns);
router.patch('/:id/scan-type',        requireAuth, updateScanType);
router.patch('/:id/watch-urls',       requireAuth, updateWatchUrls);
router.post('/:id/pause',             requireAuth, pauseMonitor);
router.post('/:id/resume',            requireAuth, resumeMonitor);
router.delete('/:id',                 requireAuth, stopMonitor);

export { router as monitoringRouter };
