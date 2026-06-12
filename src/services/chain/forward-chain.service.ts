/**
 * PINIT-DNA — Forward Chain Intelligence Service (Phase 5)
 *
 * Builds a propagation graph for a DNA record showing:
 *   Owner → ShareLink → Recipients → (potential reshares via watermark extraction)
 *
 * Returns graph data (nodes + edges) suitable for D3 force-directed rendering.
 */

import { prisma } from '../../lib/prisma';

// ── Graph types ───────────────────────────────────────────────────────────────

export type NodeType = 'OWNER' | 'DNA_RECORD' | 'SHARE_LINK' | 'RECIPIENT' | 'LEAK_EVENT';

export interface ChainNode {
  id:       string;
  type:     NodeType;
  label:    string;
  sublabel?: string;
  meta?: {
    createdAt?:    string;
    country?:      string;
    riskLevel?:    string;
    severity?:     string;
    sessions?:     number;
    viewCount?:    number;
    watermarks?:   number;
    leaked?:       boolean;
    mimeType?:     string;
    filename?:     string;
    token?:        string;
  };
}

export interface ChainEdge {
  id:       string;
  source:   string;
  target:   string;
  label?:   string;
  type:     'SHARES' | 'ACCESSES' | 'WATERMARKED' | 'LEAKED';
  weight:   number;
  meta?: {
    count?:    number;
    firstAt?:  string;
    lastAt?:   string;
    country?:  string;
  };
}

export interface ChainGraph {
  nodes: ChainNode[];
  edges: ChainEdge[];
  stats: {
    totalShares:     number;
    totalRecipients: number;
    totalViews:      number;
    leakedWatermarks:number;
    countriesReached:string[];
    riskDistribution:{ LOW: number; MEDIUM: number; HIGH: number; CRITICAL: number };
  };
}

// ── Builder ───────────────────────────────────────────────────────────────────

export async function buildForwardChain(dnaRecordId: string): Promise<ChainGraph> {
  const nodes: ChainNode[] = [];
  const edges: ChainEdge[] = [];
  const nodeIds = new Set<string>();

  function addNode(n: ChainNode) {
    if (!nodeIds.has(n.id)) { nodes.push(n); nodeIds.add(n.id); }
  }
  function addEdge(e: ChainEdge) { edges.push(e); }

  // ── 1. DNA Record root node ─────────────────────────────────────────────────

  const dna = await prisma.dnaRecord.findUnique({
    where: { id: dnaRecordId },
    include: { vaultRecord: true },
  });
  if (!dna) return { nodes: [], edges: [], stats: { totalShares: 0, totalRecipients: 0, totalViews: 0, leakedWatermarks: 0, countriesReached: [], riskDistribution: { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 } } };

  const filename = dna.vaultRecord?.originalFileName ?? dna.imageFilename ?? 'Unknown File';

  addNode({
    id:       dnaRecordId,
    type:     'DNA_RECORD',
    label:    filename,
    sublabel: dna.fileType ?? 'FILE',
    meta: {
      createdAt: dna.createdAt.toISOString(),
      mimeType:  dna.vaultRecord?.originalMimeType ?? dna.imageMimeType,
      filename,
    },
  });

  // ── 2. Share links ──────────────────────────────────────────────────────────

  const shareLinks = await prisma.shareLink.findMany({
    where: { dnaRecordId },
    orderBy: { createdAt: 'asc' },
  });

  for (const sl of shareLinks) {
    addNode({
      id:       sl.id,
      type:     'SHARE_LINK',
      label:    sl.token.slice(0, 8) + '…',
      sublabel: sl.isActive ? 'ACTIVE' : 'REVOKED',
      meta: {
        createdAt: sl.createdAt.toISOString(),
        viewCount: sl.viewCount,
        token:     sl.token,
        filename:  sl.filename,
        riskLevel: sl.isActive ? 'NONE' : 'REVOKED',
      },
    });

    addEdge({
      id:     `dna-sl-${sl.id}`,
      source: dnaRecordId,
      target: sl.id,
      type:   'SHARES',
      label:  'shared via',
      weight: 1,
      meta:   { firstAt: sl.createdAt.toISOString() },
    });
  }

  // ── 3. Watermark profiles (per-recipient marks) ─────────────────────────────

  const watermarkProfiles = await prisma.watermarkProfile.findMany({
    where: { dnaRecordId },
    include: { recipientProfile: true },
    orderBy: { createdAt: 'asc' },
  });

  // Map shareLinkId → [watermark] for recipient edges
  const slToWatermarks = new Map<string, typeof watermarkProfiles>();
  for (const wm of watermarkProfiles) {
    const list = slToWatermarks.get(wm.shareLinkId) ?? [];
    list.push(wm);
    slToWatermarks.set(wm.shareLinkId, list);
  }

  // Build recipient nodes + watermark edges
  for (const wm of watermarkProfiles) {
    if (!wm.recipientProfile) continue;
    const rp = wm.recipientProfile;
    const nodeId = `rec-${rp.id}`;

    addNode({
      id:       nodeId,
      type:     'RECIPIENT',
      label:    rp.recipientCode,
      sublabel: rp.countries[0] ?? 'Unknown',
      meta: {
        createdAt: rp.firstSeen.toISOString(),
        country:   rp.countries[0] ?? undefined,
        sessions:  rp.totalSessions,
        leaked:    !!wm.extractedAt,
      },
    });

    addEdge({
      id:     `sl-rec-${wm.id}`,
      source: wm.shareLinkId,
      target: nodeId,
      type:   'WATERMARKED',
      label:  wm.watermarkCode,
      weight: 2,
      meta: {
        firstAt: wm.createdAt.toISOString(),
        country: rp.countries[0] ?? undefined,
      },
    });

    // Leak event node if watermark was extracted
    if (wm.extractedAt) {
      const leakId = `leak-${wm.id}`;
      addNode({
        id:       leakId,
        type:     'LEAK_EVENT',
        label:    '🚨 LEAKED',
        sublabel: wm.watermarkCode,
        meta: {
          createdAt: wm.extractedAt.toISOString(),
          severity:  'CRITICAL',
          leaked:    true,
        },
      });
      addEdge({
        id:     `rec-leak-${wm.id}`,
        source: nodeId,
        target: leakId,
        type:   'LEAKED',
        label:  'leaked',
        weight: 3,
        meta:   { firstAt: wm.extractedAt.toISOString() },
      });
    }
  }

  // ── 4. Access log events — fill in recipients not yet in watermark table ──────

  const accessLogs = await prisma.shareAccessLog.findMany({
    where: { shareLinkId: { in: shareLinks.map(s => s.id) } },
    select: {
      id: true, shareLinkId: true, action: true, country: true,
      ipAddress: true, createdAt: true, riskLevel: true,
      deviceFingerprint: true, city: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  // Group by fingerprint to represent unique anonymous visitors
  const fpMap = new Map<string, typeof accessLogs[0][]>();
  for (const log of accessLogs) {
    const key = log.deviceFingerprint ?? log.ipAddress ?? 'unknown';
    const list = fpMap.get(key) ?? [];
    list.push(log);
    fpMap.set(key, list);
  }

  let anonIdx = 0;
  for (const [fp, logs] of fpMap.entries()) {
    const firstLog = logs[0];
    const anonId   = `anon-${fp.slice(0, 12)}`;

    // Skip if already represented by a watermark recipient
    if (nodeIds.has(anonId)) continue;

    anonIdx++;
    addNode({
      id:       anonId,
      type:     'RECIPIENT',
      label:    `Visitor #${anonIdx}`,
      sublabel: firstLog.country ?? 'Unknown',
      meta: {
        createdAt: firstLog.createdAt.toISOString(),
        country:   firstLog.country ?? undefined,
        sessions:  logs.filter(l => l.action === 'VIEWED').length,
        riskLevel: logs.find(l => l.riskLevel === 'CRITICAL')?.riskLevel
                ?? logs.find(l => l.riskLevel === 'HIGH')?.riskLevel
                ?? firstLog.riskLevel ?? undefined,
        leaked:    false,
      },
    });

    const sl = firstLog.shareLinkId;
    if (nodeIds.has(sl)) {
      addEdge({
        id:     `sl-anon-${anonId}-${sl}`,
        source: sl,
        target: anonId,
        type:   'ACCESSES',
        label:  `${logs.length} events`,
        weight: 1,
        meta: {
          count:   logs.length,
          firstAt: firstLog.createdAt.toISOString(),
          lastAt:  logs[logs.length - 1].createdAt.toISOString(),
          country: firstLog.country ?? undefined,
        },
      });
    }
  }

  // ── 5. Stats ────────────────────────────────────────────────────────────────

  const countries = new Set<string>();
  for (const log of accessLogs) {
    if (log.country) countries.add(log.country);
  }

  const riskDist = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  for (const log of accessLogs) {
    const k = (log.riskLevel ?? 'LOW') as keyof typeof riskDist;
    if (k in riskDist) riskDist[k]++;
  }

  const leakedWatermarks = watermarkProfiles.filter(w => w.extractedAt).length;

  return {
    nodes,
    edges,
    stats: {
      totalShares:     shareLinks.length,
      totalRecipients: nodes.filter(n => n.type === 'RECIPIENT').length,
      totalViews:      accessLogs.filter(l => l.action === 'VIEWED').length,
      leakedWatermarks,
      countriesReached: [...countries],
      riskDistribution: riskDist,
    },
  };
}
