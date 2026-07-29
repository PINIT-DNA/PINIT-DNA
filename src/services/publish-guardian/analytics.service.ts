/**
 * Publish Guardian analytics / ops metrics (additive read model).
 */

import { prisma } from '../../lib/prisma';

export async function getPublishGuardianStats(ownerUserId: string) {
  const [
    total,
    monitoringRunning,
    monitoringPaused,
    monitoringFailed,
    monitoringPending,
    discoveries,
    tampered,
    highRisk,
    byPlatform,
    byStatus,
    recent,
  ] = await Promise.all([
    prisma.protectedPost.count({ where: { ownerUserId, status: { not: 'ARCHIVED' } } }),
    prisma.protectedPost.count({ where: { ownerUserId, monitorStatus: 'RUNNING' } }),
    prisma.protectedPost.count({ where: { ownerUserId, monitorStatus: 'PAUSED' } }),
    prisma.protectedPost.count({ where: { ownerUserId, monitorStatus: 'FAILED' } }),
    prisma.protectedPost.count({ where: { ownerUserId, monitorStatus: 'PENDING' } }),
    prisma.protectedPostDiscovery.count({
      where: { protectedPost: { ownerUserId } },
    }),
    prisma.protectedPost.count({
      where: { ownerUserId, tamperedCount: { gt: 0 }, status: { not: 'ARCHIVED' } },
    }),
    prisma.protectedPost.count({
      where: { ownerUserId, riskScore: { gte: 75 }, status: { not: 'ARCHIVED' } },
    }),
    prisma.protectedPost.groupBy({
      by: ['platform'],
      where: { ownerUserId, status: { not: 'ARCHIVED' } },
      _count: { _all: true },
    }),
    prisma.protectedPost.groupBy({
      by: ['status'],
      where: { ownerUserId },
      _count: { _all: true },
    }),
    prisma.protectedPost.findMany({
      where: { ownerUserId, status: { not: 'ARCHIVED' } },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        platform: true,
        status: true,
        monitorStatus: true,
        riskScore: true,
        lastScanAt: true,
        nextScanAt: true,
        discoveriesCount: true,
      },
    }),
  ]);

  const scanTimes = await prisma.protectedPost.aggregate({
    where: { ownerUserId, avgScanMs: { not: null } },
    _avg: { avgScanMs: true },
  });

  const lastScan = await prisma.protectedPost.findFirst({
    where: { ownerUserId, lastScanAt: { not: null } },
    orderBy: { lastScanAt: 'desc' },
    select: { lastScanAt: true },
  });

  const nextScan = await prisma.protectedPost.findFirst({
    where: { ownerUserId, nextScanAt: { not: null }, monitorStatus: 'RUNNING' },
    orderBy: { nextScanAt: 'asc' },
    select: { nextScanAt: true },
  });

  return {
    protectedPosts: total,
    monitoringJobs: {
      running: monitoringRunning,
      paused: monitoringPaused,
      failed: monitoringFailed,
      pending: monitoringPending,
      total: monitoringRunning + monitoringPaused + monitoringFailed + monitoringPending,
    },
    totalDiscoveries: discoveries,
    tamperedAssets: tampered,
    highRisk,
    averageScanTimeMs: scanTimes._avg.avgScanMs != null ? Math.round(scanTimes._avg.avgScanMs) : null,
    lastScanAt: lastScan?.lastScanAt?.toISOString() ?? null,
    nextScanAt: nextScan?.nextScanAt?.toISOString() ?? null,
    platformDistribution: byPlatform.map((r) => ({
      platform: r.platform,
      count: r._count._all,
    })),
    statusDistribution: byStatus.map((r) => ({
      status: r.status,
      count: r._count._all,
    })),
    recent,
  };
}
