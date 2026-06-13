import { Router } from 'express';
import {
  enrollMonitor, listMonitors, runCheckNow,
  getAlerts, dismissAlert, confirmAlert,
  getMonitoringStats, pauseMonitor, resumeMonitor, stopMonitor,
  getMonitorRuns, updateScanType, enrollAll,
} from '../controllers/monitoring.controller';

const router = Router();

router.get('/stats',                  getMonitoringStats);
router.post('/enroll-all',            enrollAll);
router.get('/',                       listMonitors);
router.post('/enroll/:dnaRecordId',   enrollMonitor);
router.get('/alerts',                 getAlerts);
router.post('/alerts/:id/dismiss',    dismissAlert);
router.post('/alerts/:id/confirm',    confirmAlert);
router.post('/:id/check',             runCheckNow);
router.get('/:id/runs',               getMonitorRuns);
router.patch('/:id/scan-type',        updateScanType);
router.post('/:id/pause',             pauseMonitor);
router.post('/:id/resume',            resumeMonitor);
router.delete('/:id',                 stopMonitor);

export { router as monitoringRouter };
