/**
 * Milestone D — recall-first enterprise candidate retrieval.
 *
 * Providers execute independently and return retrieval evidence only. Their
 * outputs are unioned before the final limit; provider failure never aborts
 * retrieval. No ownership, acceptance, or comparison scoring occurs here.
 */
import crypto from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  ENTERPRISE_FEATURE_FLAG,
  isEnterpriseFeatureEnabled,
} from '../../config/enterprise-feature-flags';
import { dnaPhase2, isPhase2Active } from '../../config/dna-phase2';
import { parseEnterpriseDnaPackage } from '../dna/enterprise-dna-package.service';
import { PerceptualLayer } from '../layers/layer3.perceptual';
import { OcrService } from '../ocr/ocr.service';
import type { RankedVaultCandidate } from '../../types/unified-investigation.types';
import type { ForensicImageVariant } from './forensic-image-preprocessor.service';
import type { LocalDnaSearchHit } from './vault-local-dna-search.service';
import type { VaultSimilarityVector } from './vault-similarity-vector.service';
import { vaultSimilarityVectorService } from './vault-similarity-vector.service';
import { enterpriseRetrievalEngine } from './enterprise-retrieval-engine.service';
import { forensicScannerService } from './forensic-scanner.service';

export type EnterpriseCandidateProviderName =
  | 'sha256_exact'
  | 'stored_enterprise_dna'
  | 'perceptual_fingerprint'
  | 'visual_fingerprint'
  | 'metadata'
  | 'ocr'
  | 'local_feature'
  | 'ann'
  | 'legacy_registry';

export interface EnterpriseProviderCandidate {
  provider: EnterpriseCandidateProviderName;
  vaultId: string;
  dnaRecordId: string;
  ownerUserId: string;
  retrievalConfidence: number;
  method: string;
  signals: string[];
  filename?: string;
}

export interface EnterpriseCandidateProviderResult {
  provider: EnterpriseCandidateProviderName;
  candidates: EnterpriseProviderCandidate[];
  durationMs: number;
  error?: string;
}

export interface EnterpriseRecallInput {
  buffer: Buffer;
  mimeType: string;
  originalName: string;
  sizeBytes: number;
  ownerUserId: string;
  variants: ForensicImageVariant[];
  finalLimit?: number;
}

export interface EnterpriseRecallResult {
  candidates: RankedVaultCandidate[];
  providerResults: EnterpriseCandidateProviderResult[];
  localDnaHits: LocalDnaSearchHit[];
  visualVectors: VaultSimilarityVector[];
  mergedCandidateCount: number;
  finalCandidateCount: number;
}

export interface CandidateProvider {
  name: EnterpriseCandidateProviderName;
  enabled: boolean;
  retrieve(): Promise<EnterpriseProviderCandidate[]>;
}

const perceptual = new PerceptualLayer();
const ocr = new OcrService();

function hammingHexSimilarity(a: string, b: string, bits = 64): number {
  if (!a || !b || a.length !== b.length) return 0;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i]!, 16) ^ parseInt(b[i]!, 16);
    distance += (xor & 1) + ((xor >> 1) & 1) + ((xor >> 2) & 1) + ((xor >> 3) & 1);
  }
  return Math.max(0, 1 - distance / bits);
}

function normalizedStem(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/\s*\(\d+\)\s*/g, '')
    .replace(/\s*-\s*copy/gi, '')
    .replace(/[_\-.]+/g, ' ')
    .trim()
    .toLowerCase();
}

function textSimilarity(a: string, b: string): number {
  const words = (value: string) =>
    new Set(value.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
  const left = words(a);
  const right = words(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const word of left) if (right.has(word)) overlap++;
  return overlap / (left.size + right.size - overlap);
}

export function mergeEnterpriseProviderCandidates(
  providerResults: readonly EnterpriseCandidateProviderResult[],
  finalLimit = 100,
): { merged: RankedVaultCandidate[]; mergedCandidateCount: number } {
  const byVault = new Map<string, EnterpriseProviderCandidate & { providers: Set<string> }>();

  for (const result of providerResults) {
    for (const candidate of result.candidates) {
      const existing = byVault.get(candidate.vaultId);
      if (!existing) {
        byVault.set(candidate.vaultId, {
          ...candidate,
          signals: [...new Set(candidate.signals)],
          providers: new Set([candidate.provider]),
        });
        continue;
      }
      existing.providers.add(candidate.provider);
      existing.retrievalConfidence = Math.max(
        existing.retrievalConfidence,
        candidate.retrievalConfidence,
      );
      existing.signals = [...new Set([...existing.signals, ...candidate.signals])];
      if (!existing.filename && candidate.filename) existing.filename = candidate.filename;
      existing.method = `Enterprise recall (${[...existing.providers].join(', ')})`;
    }
  }

  const mergedCandidateCount = byVault.size;
  const merged = [...byVault.values()]
    .sort((a, b) =>
      b.retrievalConfidence - a.retrievalConfidence
      || b.providers.size - a.providers.size
      || a.vaultId.localeCompare(b.vaultId))
    .slice(0, Math.max(1, finalLimit))
    .map((candidate, index): RankedVaultCandidate => ({
      rank: index + 1,
      vaultId: candidate.vaultId,
      dnaRecordId: candidate.dnaRecordId,
      ownerUserId: candidate.ownerUserId,
      preliminaryScore: candidate.retrievalConfidence,
      compositeScore: candidate.retrievalConfidence,
      tier: candidate.retrievalConfidence === 100 ? 1 : 3,
      method: candidate.method.startsWith('Enterprise recall')
        ? candidate.method
        : `Enterprise recall (${[...candidate.providers].join(', ')})`,
      signals: [...new Set([
        ...candidate.signals,
        ...[...candidate.providers].map((provider) => `provider:${provider}`),
      ])],
    }));

  return { merged, mergedCandidateCount };
}

async function executeProvider(provider: CandidateProvider): Promise<EnterpriseCandidateProviderResult> {
  const startedAt = Date.now();
  logger.info('[EnterpriseRecall] provider executed', { provider: provider.name });
  try {
    const candidates = provider.enabled ? await provider.retrieve() : [];
    const durationMs = Date.now() - startedAt;
    logger.info('[EnterpriseRecall] provider complete', {
      provider: provider.name,
      durationMs,
      candidatesReturned: candidates.length,
      enabled: provider.enabled,
    });
    return { provider: provider.name, candidates, durationMs };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    logger.warn('[EnterpriseRecall] provider failed; continuing', {
      provider: provider.name,
      durationMs,
      error: String(error),
    });
    return {
      provider: provider.name,
      candidates: [],
      durationMs,
      error: String(error),
    };
  }
}

export async function runEnterpriseCandidateProviders(
  providers: readonly CandidateProvider[],
): Promise<EnterpriseCandidateProviderResult[]> {
  return Promise.all(providers.map(executeProvider));
}

export class EnterpriseCandidateRetrievalService {
  async retrieve(input: EnterpriseRecallInput): Promise<EnterpriseRecallResult> {
    const probeHash = crypto.createHash('sha256').update(input.buffer).digest('hex');
    const normalized = input.variants.find((variant) => variant.label === 'normalized')
      ?? input.variants[0]
      ?? { label: 'original', buffer: input.buffer, mimeType: input.mimeType };
    const probePerceptual = input.mimeType.startsWith('image/')
      ? perceptual.computeFingerprints(normalized.buffer)
      : Promise.resolve(null);

    let localDnaHits: LocalDnaSearchHit[] = [];
    let visualVectors: VaultSimilarityVector[] = [];

    const providers: CandidateProvider[] = [
      {
        name: 'sha256_exact',
        enabled: true,
        retrieve: async () => {
          const rows = await prisma.dnaRecord.findMany({
            where: {
              ownerUserId: input.ownerUserId,
              vaultRecord: { isNot: null },
              OR: [{ sha256Hash: probeHash }, { cryptoLayer: { sha256Hash: probeHash } }],
            },
            select: {
              id: true,
              ownerUserId: true,
              imageFilename: true,
              vaultRecord: { select: { id: true } },
            },
          });
          return rows.flatMap((row) => row.vaultRecord ? [{
            provider: 'sha256_exact' as const,
            vaultId: row.vaultRecord.id,
            dnaRecordId: row.id,
            ownerUserId: row.ownerUserId ?? input.ownerUserId,
            retrievalConfidence: 100,
            method: 'SHA-256 exact retrieval',
            signals: ['cryptographic_hash'],
            filename: row.imageFilename,
          }] : []);
        },
      },
      {
        name: 'stored_enterprise_dna',
        enabled: true,
        retrieve: async () => {
          const [rows, probe] = await Promise.all([
            prisma.dnaRecord.findMany({
              where: { ownerUserId: input.ownerUserId, vaultRecord: { isNot: null } },
              select: {
                id: true,
                ownerUserId: true,
                imageFilename: true,
                universalFingerprints: true,
                vaultRecord: { select: { id: true } },
              },
            }),
            probePerceptual,
          ]);
          return rows.flatMap((row) => {
            if (!row.vaultRecord) return [];
            const pkg = parseEnterpriseDnaPackage(row.universalFingerprints);
            if (!pkg || pkg.generationStatus !== 'COMPLETE') return [];
            const l1 = pkg.layers.find((layer) => layer.layerNumber === 1)?.fingerprint ?? '';
            const l3 = pkg.layers.find((layer) => layer.layerNumber === 3)?.fingerprint ?? '';
            const exact = pkg.contentId === probeHash || l1 === probeHash;
            const similarity = probe && l3
              ? Math.round(hammingHexSimilarity(probe.pHash64, l3, 64) * 100)
              : 0;
            if (!exact && similarity < 30) return [];
            return [{
              provider: 'stored_enterprise_dna' as const,
              vaultId: row.vaultRecord.id,
              dnaRecordId: row.id,
              ownerUserId: row.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: exact ? 100 : similarity,
              method: 'Stored Enterprise DNA retrieval',
              signals: exact
                ? ['enterprise_dna', 'cryptographic_hash']
                : ['enterprise_dna', 'perceptual_hash'],
              filename: row.imageFilename,
            }];
          });
        },
      },
      {
        name: 'perceptual_fingerprint',
        enabled: input.mimeType.startsWith('image/'),
        retrieve: async () => {
          const [rows, probe] = await Promise.all([
            prisma.dnaRecord.findMany({
              where: {
                ownerUserId: input.ownerUserId,
                vaultRecord: { isNot: null },
                perceptualLayer: { isNot: null },
              },
              select: {
                id: true,
                ownerUserId: true,
                imageFilename: true,
                vaultRecord: { select: { id: true } },
                perceptualLayer: { select: { pHash64: true, aHash64: true, dHash64: true } },
              },
            }),
            probePerceptual,
          ]);
          if (!probe) return [];
          return rows.flatMap((row) => {
            if (!row.vaultRecord || !row.perceptualLayer?.pHash64) return [];
            const similarity = Math.round(perceptual.verify(probe, {
              pHash64: row.perceptualLayer.pHash64,
              aHash64: row.perceptualLayer.aHash64 ?? '',
              dHash64: row.perceptualLayer.dHash64 ?? '',
            }) * 100);
            if (similarity < 30) return [];
            return [{
              provider: 'perceptual_fingerprint' as const,
              vaultId: row.vaultRecord.id,
              dnaRecordId: row.id,
              ownerUserId: row.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: similarity,
              method: 'Perceptual fingerprint retrieval',
              signals: ['perceptual_hash'],
              filename: row.imageFilename,
            }];
          });
        },
      },
      {
        name: 'visual_fingerprint',
        enabled: isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.VISUAL_RETRIEVAL_V2),
        retrieve: async () => {
          visualVectors = await vaultSimilarityVectorService.scoreEntireVault(
            input.buffer,
            input.mimeType,
            input.originalName,
            input.sizeBytes,
            input.ownerUserId,
            input.variants,
            { relaxedVisual: true, skipOrb: true },
          );
          return visualVectors.map((vector) => ({
            provider: 'visual_fingerprint' as const,
            vaultId: vector.vaultId,
            dnaRecordId: vector.dnaRecordId,
            ownerUserId: vector.ownerUserId,
            retrievalConfidence: vector.scores.composite,
            method: 'Visual fingerprint retrieval',
            signals: [...vector.signals, 'visual_retrieval_v2'],
            filename: vector.filename,
          }));
        },
      },
      {
        name: 'metadata',
        enabled: true,
        retrieve: async () => {
          const rows = await prisma.vaultRecord.findMany({
            where: { dnaRecord: { ownerUserId: input.ownerUserId } },
            select: {
              id: true,
              dnaRecordId: true,
              originalFileName: true,
              originalSizeBytes: true,
              dnaRecord: { select: { ownerUserId: true } },
            },
          });
          const probeName = normalizedStem(input.originalName);
          return rows.flatMap((row) => {
            const storedName = normalizedStem(row.originalFileName);
            const exactName = !!probeName && probeName === storedName;
            const fuzzyName = !!probeName && !!storedName
              && (probeName.includes(storedName) || storedName.includes(probeName));
            const sizeRatio = Math.min(row.originalSizeBytes, input.sizeBytes)
              / Math.max(row.originalSizeBytes, input.sizeBytes, 1);
            const confidence = exactName ? 85 : fuzzyName ? 60 : sizeRatio >= 0.95 ? 45 : 0;
            if (!confidence) return [];
            return [{
              provider: 'metadata' as const,
              vaultId: row.id,
              dnaRecordId: row.dnaRecordId,
              ownerUserId: row.dnaRecord.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: confidence,
              method: 'Metadata retrieval',
              signals: [
                ...(exactName ? ['filename_exact'] : fuzzyName ? ['filename_fuzzy'] : []),
                ...(sizeRatio >= 0.95 ? ['size_match'] : []),
              ],
              filename: row.originalFileName,
            }];
          });
        },
      },
      {
        name: 'ocr',
        enabled: isPhase2Active() && dnaPhase2.ocr,
        retrieve: async () => {
          const probe = await ocr.extractText(input.buffer, input.mimeType);
          if (!probe.success || !probe.text.trim()) return [];
          const rows = await prisma.ocrRecord.findMany({
            where: {
              extractedText: { not: null },
              dnaRecord: {
                ownerUserId: input.ownerUserId,
                vaultRecord: { isNot: null },
              },
            },
            select: {
              dnaRecordId: true,
              extractedText: true,
              dnaRecord: {
                select: {
                  ownerUserId: true,
                  imageFilename: true,
                  vaultRecord: { select: { id: true } },
                },
              },
            },
          });
          return rows.flatMap((row) => {
            if (!row.dnaRecord.vaultRecord || !row.extractedText) return [];
            const confidence = Math.round(textSimilarity(probe.text, row.extractedText) * 100);
            if (confidence < 30) return [];
            return [{
              provider: 'ocr' as const,
              vaultId: row.dnaRecord.vaultRecord.id,
              dnaRecordId: row.dnaRecordId,
              ownerUserId: row.dnaRecord.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: confidence,
              method: 'OCR retrieval',
              signals: ['ocr_text'],
              filename: row.dnaRecord.imageFilename,
            }];
          });
        },
      },
      {
        name: 'local_feature',
        enabled: isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.PATCH_DNA_ENGINE),
        retrieve: async () => {
          if (!input.mimeType.startsWith('image/')) return [];
          const result = await enterpriseRetrievalEngine.retrieve(
            input.buffer,
            input.mimeType,
            input.ownerUserId,
            { investigationFast: true, skipOrbRefine: true },
          );
          localDnaHits = result.localDnaHits;
          return localDnaHits.map((hit) => ({
            provider: 'local_feature' as const,
            vaultId: hit.vaultId,
            dnaRecordId: hit.dnaRecordId,
            ownerUserId: hit.ownerUserId,
            retrievalConfidence: hit.compositeScore,
            method: 'Local feature / patch retrieval',
            signals: [...hit.signals, 'local_feature'],
            filename: hit.filename,
          }));
        },
      },
      {
        name: 'ann',
        enabled: isEnterpriseFeatureEnabled(ENTERPRISE_FEATURE_FLAG.ANN_RETRIEVAL),
        retrieve: async () => {
          const scan = await forensicScannerService.scanProbe(input.buffer, input.mimeType);
          const ids = scan.candidates
            .filter((candidate) => candidate.dnaRecordId)
            .map((candidate) => candidate.dnaRecordId!);
          if (!ids.length) return [];
          const rows = await prisma.dnaRecord.findMany({
            where: {
              id: { in: ids },
              ownerUserId: input.ownerUserId,
              vaultRecord: { isNot: null },
            },
            select: {
              id: true,
              ownerUserId: true,
              imageFilename: true,
              vaultRecord: { select: { id: true } },
            },
          });
          const byDna = new Map(rows.map((row) => [row.id, row]));
          return scan.candidates.flatMap((candidate) => {
            if (!candidate.dnaRecordId) return [];
            const row = byDna.get(candidate.dnaRecordId);
            if (!row?.vaultRecord) return [];
            return [{
              provider: 'ann' as const,
              vaultId: row.vaultRecord.id,
              dnaRecordId: row.id,
              ownerUserId: row.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: candidate.confidence,
              method: 'ANN visual retrieval',
              signals: ['ann_retrieval', 'tile_faiss'],
              filename: candidate.filename ?? row.imageFilename,
            }];
          });
        },
      },
      {
        name: 'legacy_registry',
        enabled: true,
        retrieve: async () => {
          const [rows, probe] = await Promise.all([
            prisma.dnaRecord.findMany({
              where: { ownerUserId: input.ownerUserId, vaultRecord: { isNot: null } },
              select: {
                id: true,
                ownerUserId: true,
                imageFilename: true,
                sha256Hash: true,
                universalFingerprints: true,
                vaultRecord: { select: { id: true } },
                cryptoLayer: { select: { sha256Hash: true } },
                perceptualLayer: { select: { pHash64: true } },
              },
            }),
            probePerceptual,
          ]);
          return rows.flatMap((row) => {
            if (!row.vaultRecord || parseEnterpriseDnaPackage(row.universalFingerprints)) return [];
            const exact = row.sha256Hash === probeHash || row.cryptoLayer?.sha256Hash === probeHash;
            const similarity = probe && row.perceptualLayer?.pHash64
              ? Math.round(hammingHexSimilarity(probe.pHash64, row.perceptualLayer.pHash64, 64) * 100)
              : 0;
            if (!exact && similarity < 30) return [];
            return [{
              provider: 'legacy_registry' as const,
              vaultId: row.vaultRecord.id,
              dnaRecordId: row.id,
              ownerUserId: row.ownerUserId ?? input.ownerUserId,
              retrievalConfidence: exact ? 100 : similarity,
              method: 'Legacy registry retrieval',
              signals: exact ? ['legacy_registry', 'cryptographic_hash'] : ['legacy_registry', 'perceptual_hash'],
              filename: row.imageFilename,
            }];
          });
        },
      },
    ];

    const providerResults = await runEnterpriseCandidateProviders(providers);
    const { merged, mergedCandidateCount } = mergeEnterpriseProviderCandidates(
      providerResults,
      input.finalLimit ?? 100,
    );

    logger.info('[EnterpriseRecall] candidates merged', {
      providersExecuted: providerResults.length,
      mergedCandidates: mergedCandidateCount,
      finalCandidateCount: merged.length,
    });

    return {
      candidates: merged,
      providerResults,
      localDnaHits,
      visualVectors,
      mergedCandidateCount,
      finalCandidateCount: merged.length,
    };
  }
}

export const enterpriseCandidateRetrievalService = new EnterpriseCandidateRetrievalService();
