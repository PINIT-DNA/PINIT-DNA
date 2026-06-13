import { Request, Response, NextFunction } from 'express';
import { monitoringService } from '../../services/crawler/monitoring.service';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export async function enrollMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { dnaRecordId } = req.params;
    const { watchUrls = [], scanType = 'DAILY' } = req.body;
    const monitorId = await monitoringService.enroll(dnaRecordId, { watchUrls, scanType });
    res.status(201).json({ success: true, monitorId, message: 'File enrolled for monitoring' });
  } catch (err) { next(err); }
}

export async function listMonitors(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const monitors = await monitoringService.listMonitors();
    res.json({ success: true, count: monitors.length, monitors });
  } catch (err) { next(err); }
}

export async function runCheckNow(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const result = await monitoringService.runCheck(req.params.id, 'MANUAL');
    res.json({ success: true, result });
  } catch (err) { next(err); }
}

export async function getMonitorRuns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const runs = await monitoringService.getMonitorRuns(req.params['id']);
    res.json({ success: true, runs });
  } catch (err) { next(err); }
}

export async function updateScanType(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { scanType } = req.body;
    if (!['MANUAL','DAILY','WEEKLY','CONTINUOUS'].includes(scanType)) {
      res.status(400).json({ success: false, error: 'Invalid scanType' });
      return;
    }
    await monitoringService.updateScanType(req.params.id, scanType);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getAlerts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const status = (req.query['status'] as string) ?? 'PENDING';
    const alerts = await monitoringService.getAlerts(status);
    res.json({ success: true, count: alerts.length, alerts });
  } catch (err) { next(err); }
}

export async function dismissAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await monitoringService.dismissAlert(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function confirmAlert(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await monitoringService.confirmAlert(req.params.id);
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function getMonitoringStats(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const stats = await monitoringService.getStats();
    res.json({ success: true, ...stats });
  } catch (err) { next(err); }
}

export async function pauseMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prisma } = await import('../../lib/prisma');
    await prisma.monitorRecord.update({ where: { id: req.params.id }, data: { status: 'PAUSED' } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function resumeMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prisma } = await import('../../lib/prisma');
    await prisma.monitorRecord.update({
      where: { id: req.params.id },
      data: { status: 'ACTIVE', nextCheckAt: new Date(Date.now() + 60_000) },
    });
    res.json({ success: true });
  } catch (err) { next(err); }
}

export async function stopMonitor(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { prisma } = await import('../../lib/prisma');
    await prisma.monitorRecord.update({ where: { id: req.params.id }, data: { status: 'STOPPED' } });
    res.json({ success: true });
  } catch (err) { next(err); }
}

// Enroll all DNA records that don't have an active monitor yet
export async function enrollAll(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const allDna = await prisma.dnaRecord.findMany({
      where: { status: { in: ['COMPLETE', 'PARTIAL'] } },
      select: { id: true, imageFilename: true },
    });

    const monitored = await prisma.monitorRecord.findMany({
      where: { status: { not: 'STOPPED' } },
      select: { dnaRecordId: true },
    });
    const monitoredIds = new Set(monitored.map(m => m.dnaRecordId));

    const unmonitored = allDna.filter(r => !monitoredIds.has(r.id));

    let enrolled = 0;
    for (const record of unmonitored) {
      try {
        await monitoringService.enroll(record.id, { scanType: 'DAILY' });
        enrolled++;
      } catch (err) {
        logger.warn('[Monitor] Bulk enroll skip', { id: record.id, error: String(err) });
      }
    }

    res.json({ success: true, enrolled, alreadyMonitored: monitoredIds.size, total: allDna.length });
  } catch (err) { next(err); }
}
