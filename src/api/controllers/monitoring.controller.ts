/**
 * PINIT-DNA — Monitoring Controller
 *
 * POST /api/v1/monitor/enroll/:dnaRecordId  — Enroll file for monitoring
 * GET  /api/v1/monitor                      — List all monitors
 * POST /api/v1/monitor/:id/check            — Run check now
 * GET  /api/v1/monitor/alerts               — Get all alerts
 * POST /api/v1/monitor/alerts/:id/dismiss   — Dismiss alert
 * POST /api/v1/monitor/alerts/:id/confirm   — Confirm match
 * GET  /api/v1/monitor/stats                — Stats
 * POST /api/v1/monitor/:id/pause            — Pause monitoring
 * POST /api/v1/monitor/:id/resume           — Resume monitoring
 * DELETE /api/v1/monitor/:id               — Stop monitoring
 */

import { Request, Response, NextFunction } from 'express';
import { monitoringService } from '../../services/crawler/monitoring.service';
import { logger }            from '../../lib/logger';
import { prisma }            from '../../lib/prisma';

export async function enrollMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { dnaRecordId } = req.params;
  const { watchUrls = [] } = req.body as { watchUrls?: string[] };
  try {
    const id = await monitoringService.enroll(dnaRecordId, watchUrls);
    res.status(201).json({ success: true, monitorId: id, message: 'File enrolled for monitoring' });
  } catch (err) { next(err); }
}

export async function listMonitors(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const monitors = await monitoringService.listMonitors();
    res.status(200).json({ success: true, count: monitors.length, monitors });
  } catch (err) { next(err); }
}

export async function runCheckNow(req: Request, res: Response, next: NextFunction): Promise<void> {
  const { id } = req.params;
  try {
    logger.info('Manual monitoring check triggered', { id });
    const result = await monitoringService.runCheck(id);
    res.status(200).json({ success: true, ...result });
  } catch (err) { next(err); }
}

export async function getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  const status = (req.query['status'] as string) ?? 'PENDING';
  try {
    const alerts = await monitoringService.getAlerts(status);
    res.status(200).json({ success: true, count: alerts.length, alerts });
  } catch (err) { next(err); }
}

export async function dismissAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await monitoringService.dismissAlert(req.params['id']);
    res.status(200).json({ success: true, message: 'Alert dismissed' });
  } catch (err) { next(err); }
}

export async function confirmAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await monitoringService.confirmAlert(req.params['id']);
    res.status(200).json({ success: true, message: 'Alert confirmed as genuine match' });
  } catch (err) { next(err); }
}

export async function getMonitoringStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await monitoringService.getStats();
    res.status(200).json({ success: true, ...stats });
  } catch (err) { next(err); }
}

export async function pauseMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await prisma.monitorRecord.update({ where: { id: req.params['id'] }, data: { status: 'PAUSED' } });
    res.status(200).json({ success: true, message: 'Monitoring paused' });
  } catch (err) { next(err); }
}

export async function resumeMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await prisma.monitorRecord.update({
      where: { id: req.params['id'] },
      data: { status: 'ACTIVE', nextCheckAt: new Date(Date.now() + 60_000) },
    });
    res.status(200).json({ success: true, message: 'Monitoring resumed' });
  } catch (err) { next(err); }
}

export async function stopMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await prisma.monitorRecord.update({ where: { id: req.params['id'] }, data: { status: 'STOPPED' } });
    res.status(200).json({ success: true, message: 'Monitoring stopped' });
  } catch (err) { next(err); }
}
