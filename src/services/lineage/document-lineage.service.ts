/**
 * PINIT-DNA — Document Lineage Service (Phase 5.2)
 *
 * Tracks relationships between DNA records:
 *   - "This PDF is derived from this image"
 *   - "This document is a modified version of that one"
 *   - "These two files are duplicates"
 *
 * Stored in the existing PostgreSQL DB (no Neo4j required for current phase).
 * The lineage graph is built from DNA comparison results.
 */

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';

export type LineageRelation =
  | 'DUPLICATE'          // DNA_MATCH (≥95% similarity)
  | 'DERIVED_FROM'       // SIMILAR (55–94%)
  | 'RELATED'            // Some layers match
  | 'MODIFIED_COPY'      // Content same, metadata different
  | 'CROP_DERIVATIVE'    // Whole-image match with Crop as the primary tamper vector
  | 'RESIZE_DERIVATIVE'  // Whole-image match with Resize as the primary tamper vector
  | 'AI_TRANSFORMED'     // Whole-image match with AI Editing/Enhancement/Generated detected
  | 'FRAGMENT_COMPOSITE'; // A fragment of this asset was found composited into the other

export interface LineageNode {
  dnaRecordId: string;
  filename:    string;
  fileType:    string;
  createdAt:   string;
}

export interface LineageEdge {
  fromId:     string;
  toId:       string;
  relation:   LineageRelation;
  confidence: number;
  detectedAt: string;
}

export interface LineageGraph {
  nodes: LineageNode[];
  edges: LineageEdge[];
}

export class DocumentLineageService {
  /**
   * Record a lineage relationship discovered during DNA comparison.
   * Called automatically after each comparison.
   */
  async recordRelationship(params: {
    dnaRecordIdA:   string;
    dnaRecordIdB:   string;
    classification: string;   // DNA_MATCH | SIMILAR | DIFFERENT
    confidence:     number;   // 0–100 — overall whole-image match confidence
    changedLayers:  string[];
    /** Additive — when available, these produce a more specific relation than
     * the raw confidence band alone (e.g. "this is specifically a crop", not
     * just "somewhat similar"). Falls back to band-based classification when
     * omitted, so existing callers keep working unchanged. */
    primaryTamperVector?: string | null;
    fragmentDetected?: boolean;
    fragmentConfidence?: number | null;
  }): Promise<void> {
    // Determine relationship type — prefer a specific, evidence-backed relation
    // over the generic confidence band when richer signal is available.
    let relation: LineageRelation;
    let edgeConfidence = params.confidence;

    if (params.fragmentDetected) {
      // A fragment match is inherently a low WHOLE-IMAGE confidence scenario by
      // definition (only part of the asset is present) — record it on its own
      // confidence rather than falling through the "too different" cutoff below.
      relation = 'FRAGMENT_COMPOSITE';
      edgeConfidence = params.fragmentConfidence ?? params.confidence;
    } else if (params.confidence >= 95) {
      relation = 'DUPLICATE';
    } else if (params.primaryTamperVector === 'CROP') {
      relation = 'CROP_DERIVATIVE';
    } else if (params.primaryTamperVector === 'RESIZE') {
      relation = 'RESIZE_DERIVATIVE';
    } else if (
      params.primaryTamperVector === 'AI_EDITING'
      || params.primaryTamperVector === 'AI_ENHANCEMENT'
      || params.primaryTamperVector === 'AI_GENERATED'
    ) {
      relation = 'AI_TRANSFORMED';
    } else if (params.confidence >= 80) {
      relation = 'MODIFIED_COPY';
    } else if (params.confidence >= 55) {
      // If only metadata changed → DERIVED_FROM
      const onlyMetaChanged = params.changedLayers.length <= 2 &&
        params.changedLayers.every(l => ['metadata', 'signature'].includes(l));
      relation = onlyMetaChanged ? 'DERIVED_FROM' : 'RELATED';
    } else {
      return; // Too different — no meaningful relationship
    }

    try {
      await prisma.documentLineage.upsert({
        where: {
          fromDnaRecordId_toDnaRecordId: {
            fromDnaRecordId: params.dnaRecordIdA,
            toDnaRecordId:   params.dnaRecordIdB,
          },
        },
        create: {
          fromDnaRecordId: params.dnaRecordIdA,
          toDnaRecordId:   params.dnaRecordIdB,
          relation,
          confidence:      edgeConfidence,
        },
        update: {
          relation,
          confidence: edgeConfidence,
        },
      });

      logger.info('Lineage relationship recorded', {
        fromId: params.dnaRecordIdA.slice(0, 8),
        toId:   params.dnaRecordIdB.slice(0, 8),
        relation, confidence: edgeConfidence,
      });
    } catch (err) {
      // Non-fatal — lineage is supplemental data
      logger.warn('Failed to record lineage', { error: String(err) });
    }
  }

  /**
   * Get the full lineage graph for a specific DNA record.
   */
  async getLineage(dnaRecordId: string): Promise<LineageGraph> {
    try {
      const [outgoing, incoming] = await Promise.all([
        prisma.documentLineage.findMany({
          where:   { fromDnaRecordId: dnaRecordId },
          include: {
            fromDnaRecord: { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
            toDnaRecord:   { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
          },
        }),
        prisma.documentLineage.findMany({
          where:   { toDnaRecordId: dnaRecordId },
          include: {
            fromDnaRecord: { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
            toDnaRecord:   { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
          },
        }),
      ]);

      const allEdges   = [...outgoing, ...incoming];
      const nodeMap    = new Map<string, LineageNode>();
      const edges: LineageEdge[] = [];

      for (const e of allEdges) {
        // Add nodes
        const from = e.fromDnaRecord;
        const to   = e.toDnaRecord;
        if (!nodeMap.has(from.id)) {
          nodeMap.set(from.id, {
            dnaRecordId: from.id,
            filename:    from.imageFilename,
            fileType:    from.fileType ?? 'IMAGE',
            createdAt:   from.createdAt.toISOString(),
          });
        }
        if (!nodeMap.has(to.id)) {
          nodeMap.set(to.id, {
            dnaRecordId: to.id,
            filename:    to.imageFilename,
            fileType:    to.fileType ?? 'IMAGE',
            createdAt:   to.createdAt.toISOString(),
          });
        }
        edges.push({
          fromId:     e.fromDnaRecordId,
          toId:       e.toDnaRecordId,
          relation:   e.relation as LineageRelation,
          confidence: e.confidence,
          detectedAt: e.createdAt.toISOString(),
        });
      }

      return { nodes: [...nodeMap.values()], edges };
    } catch {
      return { nodes: [], edges: [] };
    }
  }

  /**
   * Get all duplicate clusters — groups of files that are copies of each other.
   */
  async getDuplicateClusters(ownerUserId: string): Promise<LineageNode[][]> {
    try {
      const ownedDna = await prisma.dnaRecord.findMany({
        where: { ownerUserId },
        select: { id: true },
      });
      const ownedIds = ownedDna.map((d) => d.id);
      if (!ownedIds.length) return [];

      const duplicates = await prisma.documentLineage.findMany({
        where: {
          relation: 'DUPLICATE',
          fromDnaRecordId: { in: ownedIds },
          toDnaRecordId: { in: ownedIds },
        },
        include: {
          fromDnaRecord: { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
          toDnaRecord:   { select: { id: true, imageFilename: true, fileType: true, createdAt: true } },
        },
      });

      // Build clusters using union-find
      const parent = new Map<string, string>();
      const find = (x: string): string => {
        if (!parent.has(x)) parent.set(x, x);
        if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
        return parent.get(x)!;
      };
      const union = (x: string, y: string) => parent.set(find(x), find(y));

      const nodes = new Map<string, LineageNode>();
      for (const d of duplicates) {
        union(d.fromDnaRecordId, d.toDnaRecordId);
        nodes.set(d.fromDnaRecordId, { dnaRecordId: d.fromDnaRecord.id, filename: d.fromDnaRecord.imageFilename, fileType: d.fromDnaRecord.fileType ?? 'IMAGE', createdAt: d.fromDnaRecord.createdAt.toISOString() });
        nodes.set(d.toDnaRecordId,   { dnaRecordId: d.toDnaRecord.id,   filename: d.toDnaRecord.imageFilename,   fileType: d.toDnaRecord.fileType ?? 'IMAGE',   createdAt: d.toDnaRecord.createdAt.toISOString() });
      }

      // Group by cluster root
      const clusters = new Map<string, LineageNode[]>();
      for (const [id, node] of nodes) {
        const root = find(id);
        if (!clusters.has(root)) clusters.set(root, []);
        clusters.get(root)!.push(node);
      }

      return [...clusters.values()].filter(c => c.length > 1);
    } catch {
      return [];
    }
  }
}
