/**
 * PINIT-DNA — Super Admin Console API: Network and usage overview.
 * (Split out of super-admin.controller.ts, which re-exports it; handler code is unchanged.)
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../../lib/prisma';
import {} from '../../middleware/error.middleware';
import {} from '../../../lib/health';
import {} from '../../../services/audit/admin-audit.service';
import {} from '../../../lib/platform-owner';



// ─── GET /super-admin/network-overview ─────────────────────────────────────
// Organizational network reach — members, clients, campaigns, assets per
// org. Not a graph engine; a ranked structural view of existing relational
// data (Organization → Client → Campaign → Asset).

export async function getNetworkOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const organizations = await prisma.organization.findMany({
      include: {
        ownerUser: { select: { shortId: true, fullName: true } },
        _count: { select: { members: true, clients: true, campaigns: true, dnaRecords: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const ranked = organizations
      .map((o) => ({
        id: o.id,
        shortId: o.shortId,
        name: o.name,
        industry: o.industry,
        owner: o.ownerUser,
        members: o._count.members,
        clients: o._count.clients,
        campaigns: o._count.campaigns,
        assets: o._count.dnaRecords,
        networkSize: o._count.members + o._count.clients + o._count.campaigns,
      }))
      .sort((a, b) => b.networkSize - a.networkSize);

    const totals = ranked.reduce(
      (acc, o) => ({
        members: acc.members + o.members,
        clients: acc.clients + o.clients,
        campaigns: acc.campaigns + o.campaigns,
      }),
      { members: 0, clients: 0, campaigns: 0 },
    );

    res.json({ success: true, organizations: ranked, totals, totalOrganizations: ranked.length });
  } catch (err) {
    next(err);
  }
}

// ─── GET /super-admin/usage-overview ───────────────────────────────────────
// Real live storage consumption per user against their plan's limit —
// computed from VaultRecord, not the (currently unpopulated) UsageRecord
// metering ledger, since nothing in the codebase writes to that table yet.

export async function getUsageOverview(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const [subscriptions, vaultByOwner] = await Promise.all([
      prisma.subscription.findMany({
        include: {
          user: { select: { id: true, shortId: true, fullName: true } },
          plan: { select: { code: true, name: true, storageLimitBytes: true } },
        },
      }),
      prisma.vaultRecord.findMany({
        select: { encryptedSizeBytes: true, dnaRecord: { select: { ownerUserId: true } } },
      }),
    ]);

    const usageByOwner = new Map<string, number>();
    for (const v of vaultByOwner) {
      const ownerId = v.dnaRecord?.ownerUserId;
      if (!ownerId) continue;
      usageByOwner.set(ownerId, (usageByOwner.get(ownerId) ?? 0) + v.encryptedSizeBytes);
    }

    const rows = subscriptions.map((s) => {
      const usedBytes = usageByOwner.get(s.userId) ?? 0;
      const limitBytes = s.plan.storageLimitBytes;
      return {
        userId: s.userId,
        user: s.user,
        planCode: s.plan.code,
        planName: s.plan.name,
        usedBytes: usedBytes.toString(),
        limitBytes: limitBytes ? limitBytes.toString() : null,
        usagePct: limitBytes && limitBytes > 0n ? Number((BigInt(usedBytes) * 10000n) / limitBytes) / 100 : null,
      };
    });

    const totalUsedBytes = rows.reduce((s, r) => s + Number(r.usedBytes), 0);
    const nearLimitCount = rows.filter((r) => r.usagePct != null && r.usagePct >= 80).length;

    res.json({
      success: true,
      usage: rows.sort((a, b) => Number(b.usedBytes) - Number(a.usedBytes)),
      totalUsedBytes,
      nearLimitCount,
      metered: {
        // Honest signal to the UI that the formal per-metric ledger is empty.
        usageRecordCount: await prisma.usageRecord.count(),
      },
    });
  } catch (err) {
    next(err);
  }
}

