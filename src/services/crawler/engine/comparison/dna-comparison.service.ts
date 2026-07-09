/**
 * DNA Comparison Engine — lightweight fingerprint compare against vault DNA.
 */

import crypto from 'crypto';
import { prisma } from '../../../../lib/prisma';
import { imageCandidateService } from '../../image-candidate.service';
import { aiService } from '../../../ai/ai-embeddings.service';
import { crawlerEngineConfig } from '../config';
import type { DnaComparisonResult, DownloadedAsset } from '../types';

export class DnaComparisonService {
  async compareAsset(
    dnaRecordId: string,
    asset: DownloadedAsset,
  ): Promise<DnaComparisonResult> {
    const stored = await prisma.dnaRecord.findUnique({
      where: { id: dnaRecordId },
      include: {
        cryptoLayer: true,
        perceptualLayer: true,
        ocrRecord: true,
      },
    });

    if (!stored) {
      return { similarity: 0, matchType: 'NO_MATCH', confidence: 0, method: 'none' };
    }

    if (asset.mimeType.startsWith('image/') || asset.assetType === 'image') {
      return this.compareImage(stored, asset);
    }

    return this.compareDocument(stored, asset);
  }

  private async compareImage(
    stored: {
      cryptoLayer: { sha256Hash: string } | null;
      perceptualLayer: { pHash64: string; aHash64?: string; dHash64?: string } | null;
    },
    asset: DownloadedAsset,
  ): Promise<DnaComparisonResult> {
    const storedPHash = stored.perceptualLayer?.pHash64;
    if (!storedPHash) {
      return { similarity: 0, matchType: 'NO_MATCH', confidence: 0, method: 'phash_missing' };
    }

    const probe = await imageCandidateService.fingerprintBuffer(asset.buffer).catch(() => null);
    if (!probe) {
      return { similarity: 0, matchType: 'NO_MATCH', confidence: 0, method: 'phash_failed' };
    }

    const sim = imageCandidateService.combinedPHashSimilarity(probe, {
      pHash64: storedPHash,
      aHash64: stored.perceptualLayer?.aHash64 ?? '',
      dHash64: stored.perceptualLayer?.dHash64 ?? '',
    });
    const shaSim = stored.cryptoLayer?.sha256Hash
      ? this.shaMatch(stored.cryptoLayer.sha256Hash, asset.buffer)
      : 0;

    const similarity = Math.max(sim, shaSim);
    return {
      similarity,
      matchType: this.classify(similarity),
      confidence: similarity,
      method: shaSim >= sim ? 'sha256+phash' : 'phash',
      details: { pHashSimilarity: sim, shaSimilarity: shaSim },
    };
  }

  private async compareDocument(
    stored: {
      cryptoLayer: { sha256Hash: string } | null;
      ocrRecord: { extractedText: string | null } | null;
      imageFilename: string;
    },
    asset: DownloadedAsset,
  ): Promise<DnaComparisonResult> {
    const probeHash = crypto.createHash('sha256').update(asset.buffer).digest('hex');
    if (stored.cryptoLayer?.sha256Hash && stored.cryptoLayer.sha256Hash === probeHash) {
      return {
        similarity: 1,
        matchType: 'EXACT_MATCH',
        confidence: 1,
        method: 'sha256_exact',
      };
    }

    const storedText = stored.ocrRecord?.extractedText ?? '';
    const probeText = asset.buffer.toString('utf8').slice(0, 50_000);
    let textSim = 0;

    if (storedText.length > 20 && probeText.length > 20) {
      try {
        const searchRes = await aiService.search(probeText.slice(0, 2000), 3, 0.5);
        const hit = searchRes.results?.find((r: { similarity: number }) => r.similarity > 0);
        textSim = hit?.similarity ?? this.keywordOverlap(storedText, probeText);
      } catch {
        textSim = this.keywordOverlap(storedText, probeText);
      }
    } else {
      textSim = this.filenameSimilarity(stored.imageFilename, asset.filename);
    }

    return {
      similarity: textSim,
      matchType: this.classify(textSim),
      confidence: textSim,
      method: 'text_semantic',
      details: { probeHash: probeHash.slice(0, 16) },
    };
  }

  private shaMatch(storedSha: string, buffer: Buffer): number {
    const probe = crypto.createHash('sha256').update(buffer).digest('hex');
    return probe === storedSha ? 1 : 0;
  }

  private keywordOverlap(a: string, b: string): number {
    const wordsA = new Set(a.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
    const wordsB = new Set(b.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []);
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let overlap = 0;
    for (const w of wordsA) if (wordsB.has(w)) overlap++;
    return overlap / Math.max(wordsA.size, wordsB.size);
  }

  private filenameSimilarity(a: string, b: string): number {
    const na = a.toLowerCase().replace(/\.[^.]+$/, '');
    const nb = b.toLowerCase().replace(/\.[^.]+$/, '');
    if (na === nb) return 0.95;
    if (na.includes(nb) || nb.includes(na)) return 0.75;
    return 0;
  }

  classify(similarity: number): DnaComparisonResult['matchType'] {
    if (similarity >= 0.95) return 'EXACT_MATCH';
    if (similarity >= crawlerEngineConfig.similarityThreshold) return 'HIGH_MATCH';
    if (similarity >= crawlerEngineConfig.possibleThreshold) return 'POSSIBLE_MATCH';
    return 'NO_MATCH';
  }

  exceedsThreshold(result: DnaComparisonResult): boolean {
    return result.similarity >= crawlerEngineConfig.similarityThreshold
      && result.matchType !== 'NO_MATCH';
  }
}

export const dnaComparisonService = new DnaComparisonService();
