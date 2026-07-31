/**
 * DNA Layer Standardization — Phase 3
 * docs/architecture/03_DNA_SPECIFICATION.md
 *
 * Maps existing investigation evidence into exactly 15 slots.
 * Does NOT change algorithms, thresholds, or media adapters.
 * Each layer is built independently (one failure never blocks another).
 */
import type { ChannelState } from '../../types/acceptance.types';
import type { InvestigationOutcome } from './investigation-decision-resolver.service';
import type { UnifiedInvestigationReport } from '../../types/unified-investigation.types';
import type { ManifestMediaType } from '../../types/investigation-manifest.types';
import {
  DNA_ALGORITHM_VERSION,
  DNA_LAYER_COUNT,
  DNA_LAYER_REGISTRY_V1,
  type StandardizedDnaBundle,
  type StandardizedDnaLayer,
} from '../../types/dna-layer.types';

export interface DnaLayerStandardizationInput {
  report: UnifiedInvestigationReport;
  outcome: InvestigationOutcome;
  mediaType: ManifestMediaType;
}

function layer(
  id: number,
  name: string,
  status: ChannelState,
  score: number,
  reason: string,
  evidence: Record<string, unknown>,
  durationMs: number,
): StandardizedDnaLayer {
  return {
    id,
    name,
    status,
    score: status === 'PASS' ? Math.max(0, Math.min(100, Math.round(score))) : 0,
    reason: reason || (status === 'SKIPPED' ? 'Not applicable' : status === 'FAIL' ? 'Failed' : 'OK'),
    evidence: evidence ?? {},
    duration: Math.max(0, durationMs),
  };
}

function safeLayer(
  id: number,
  name: string,
  fn: () => StandardizedDnaLayer,
): StandardizedDnaLayer {
  const started = Date.now();
  try {
    const result = fn();
    return { ...result, duration: result.duration || Date.now() - started };
  } catch (err) {
    return layer(
      id,
      name,
      'SKIPPED',
      0,
      `Layer mapping error: ${err instanceof Error ? err.message : String(err)}`,
      {},
      Date.now() - started,
    );
  }
}

function findLegacyLayer(
  report: UnifiedInvestigationReport,
  ...names: string[]
): { matchPercent: number; status: string; explanation: string } | undefined {
  const lower = names.map((n) => n.toLowerCase());
  return report.layerAnalysis?.find((l) =>
    lower.some((n) => l.name.toLowerCase().includes(n)),
  );
}

function legacyStatus(status: string): ChannelState {
  if (status === 'verified') return 'PASS';
  if (status === 'failed') return 'FAIL';
  return 'SKIPPED';
}

/**
 * Build exactly 15 standardized DNA layers from existing report evidence.
 */
export function standardizeDnaLayers(input: DnaLayerStandardizationInput): StandardizedDnaBundle {
  const { report, outcome, mediaType } = input;
  const isVideo = mediaType === 'video';
  const isAudio = mediaType === 'audio';
  const isPdf = mediaType === 'pdf' || mediaType === 'document';

  const layers: StandardizedDnaLayer[] = DNA_LAYER_REGISTRY_V1.map((reg) =>
    safeLayer(reg.id, reg.name, () => {
      const t0 = Date.now();

      switch (reg.id) {
        case 1: {
          // Cryptographic
          const hash = report.currentFileHash
            ?? report.identityRecoveryReport?.currentHash
            ?? report.identityRecoveryReport?.originalHash;
          if (hash) {
            return layer(1, reg.name, 'PASS', 100, 'Probe content hash available', { sha256: hash }, Date.now() - t0);
          }
          return layer(1, reg.name, 'FAIL', 0, 'No cryptographic hash on probe', {}, Date.now() - t0);
        }
        case 2: {
          // Embedded Identity
          const wm = report.identityProof?.watermark?.status;
          if (wm === 'DETECTED') {
            return layer(2, reg.name, 'PASS', report.identityProof?.watermark?.confidence ?? 80, 'Watermark / identity detected', {
              watermarkStatus: wm,
              code: report.identityProof?.watermark?.code,
            }, Date.now() - t0);
          }
          if (wm === 'DAMAGED') {
            return layer(2, reg.name, 'FAIL', 20, 'Watermark damaged', { watermarkStatus: wm }, Date.now() - t0);
          }
          return layer(2, reg.name, 'FAIL', 0, 'Embedded identity not recovered', {
            watermarkStatus: wm ?? 'NOT_EMBEDDED',
          }, Date.now() - t0);
        }
        case 3: {
          // Metadata
          const meta = outcome.acceptanceScorecard.metadata;
          if (meta.state === 'SKIPPED') {
            return layer(3, reg.name, 'SKIPPED', 0, isVideo || isAudio
              ? `Limited metadata for ${mediaType}`
              : 'Metadata not evaluated', { mediaType }, Date.now() - t0);
          }
          if (meta.state === 'PASS') {
            return layer(3, reg.name, 'PASS', meta.score, 'Metadata channel present', {}, Date.now() - t0);
          }
          return layer(3, reg.name, 'FAIL', 0, 'Metadata channel failed', {}, Date.now() - t0);
        }
        case 4: {
          // Media Fingerprint
          const legacy = findLegacyLayer(report, 'perceptual', 'structural', 'fingerprint', 'crypto');
          if (legacy) {
            return layer(4, reg.name, legacyStatus(legacy.status), legacy.matchPercent, legacy.explanation || 'Media fingerprint', {
              legacyName: legacy,
            }, Date.now() - t0);
          }
          const dnaPct = report.summary.dnaMatchPercent ?? 0;
          if (dnaPct > 0) {
            return layer(4, reg.name, dnaPct >= 40 ? 'PASS' : 'FAIL', dnaPct, 'Aggregate DNA match used as media fingerprint proxy', {
              dnaMatchPercent: dnaPct,
            }, Date.now() - t0);
          }
          if (isAudio) {
            return layer(4, reg.name, 'SKIPPED', 0, 'Visual media fingerprint not applicable to audio', { mediaType }, Date.now() - t0);
          }
          return layer(4, reg.name, 'FAIL', 0, 'No media fingerprint evidence', {}, Date.now() - t0);
        }
        case 5: {
          // AI Fingerprint — no algorithm change; SKIPPED when not present
          return layer(5, reg.name, 'SKIPPED', 0, 'AI / semantic fingerprint not available', { mediaType }, Date.now() - t0);
        }
        case 6: {
          // Visual / Audio / Text Features
          const visual = outcome.acceptanceScorecard.visual;
          if (isPdf) {
            return layer(6, reg.name, 'SKIPPED', 0, 'ORB visual features not applicable to PDF/document', { mediaType }, Date.now() - t0);
          }
          if (visual.state === 'PASS') {
            return layer(6, reg.name, 'PASS', visual.score, 'Local / visual features present', {}, Date.now() - t0);
          }
          if (visual.state === 'SKIPPED') {
            return layer(6, reg.name, 'SKIPPED', 0, 'Visual features not evaluated', { mediaType }, Date.now() - t0);
          }
          return layer(6, reg.name, 'FAIL', 0, 'Visual / local features failed', {}, Date.now() - t0);
        }
        case 7: {
          // Vector Embedding
          const top = report.candidateRanking?.[0];
          if (top) {
            const score = top.compositeScore;
            return layer(7, reg.name, score >= 30 ? 'PASS' : 'FAIL', score, 'Vault vector similarity', {
              vaultId: top.vaultId,
              rank: top.rank,
            }, Date.now() - t0);
          }
          return layer(7, reg.name, 'FAIL', 0, 'No vector candidates', {}, Date.now() - t0);
        }
        case 8: {
          // Certificate
          const cert = outcome.acceptanceScorecard.certificate;
          const certId = report.owner.certificateId ?? report.identityProof?.certificateId;
          if (cert.state === 'SKIPPED' || !certId) {
            return layer(8, reg.name, 'SKIPPED', 0, 'No certificate on file', {}, Date.now() - t0);
          }
          if (cert.state === 'PASS' || report.summary.certificateStatus === 'VALID') {
            return layer(8, reg.name, 'PASS', cert.score || 100, 'Certificate valid', {
              certificateId: certId,
              status: report.summary.certificateStatus,
            }, Date.now() - t0);
          }
          return layer(8, reg.name, 'FAIL', 0, 'Certificate invalid or unverified', {
            certificateId: certId,
            status: report.summary.certificateStatus,
          }, Date.now() - t0);
        }
        case 9: {
          // Vault Mapping
          const vaultId = report.owner.vaultId ?? outcome.candidate?.vaultId;
          if (vaultId) {
            return layer(9, reg.name, 'PASS', 100, 'Authoritative vault locked', { vaultId }, Date.now() - t0);
          }
          return layer(9, reg.name, 'FAIL', 0, 'No vault mapping', {}, Date.now() - t0);
        }
        case 10: {
          // Timeline
          const timeline = outcome.acceptanceScorecard.timeline;
          const events = report.timeline?.length ?? 0;
          if (timeline.state === 'PASS' || events > 0) {
            return layer(10, reg.name, 'PASS', timeline.score || (events > 0 ? 100 : 0), 'Custody timeline present', {
              eventCount: events,
            }, Date.now() - t0);
          }
          if (timeline.state === 'SKIPPED') {
            return layer(10, reg.name, 'SKIPPED', 0, 'Timeline not evaluated', {}, Date.now() - t0);
          }
          return layer(10, reg.name, 'FAIL', 0, 'No timeline custody link', {}, Date.now() - t0);
        }
        case 11: {
          // Similarity
          const dnaPct = report.summary.dnaMatchPercent ?? outcome.acceptanceScorecard.dna.score ?? 0;
          const retrieval = report.summary.retrievalConfidence ?? 0;
          const score = Math.max(dnaPct, retrieval);
          if (score <= 0 && !outcome.candidate) {
            return layer(11, reg.name, 'FAIL', 0, 'No similarity evidence', {}, Date.now() - t0);
          }
          if (score >= 40) {
            return layer(11, reg.name, 'PASS', score, 'Aggregate similarity', {
              dnaMatchPercent: dnaPct,
              retrievalConfidence: retrieval,
            }, Date.now() - t0);
          }
          return layer(11, reg.name, 'FAIL', score, 'Similarity below evidence band', {
            dnaMatchPercent: dnaPct,
            retrievalConfidence: retrieval,
          }, Date.now() - t0);
        }
        case 12: {
          // Owner Verification
          const owner = outcome.acceptanceScorecard.owner;
          const pinitId = report.owner.ownerPinitId;
          if (owner.state === 'PASS' && pinitId) {
            return layer(12, reg.name, 'PASS', owner.score, 'Owner bound to vault', {
              ownerPinitId: pinitId,
              ownerName: report.owner.ownerName,
            }, Date.now() - t0);
          }
          if (!pinitId) {
            return layer(12, reg.name, 'FAIL', 0, 'Owner not bound', {}, Date.now() - t0);
          }
          return layer(12, reg.name, owner.state === 'SKIPPED' ? 'SKIPPED' : 'FAIL', 0, 'Owner verification failed', {
            ownerPinitId: pinitId,
          }, Date.now() - t0);
        }
        case 13: {
          // Tamper Analysis
          const tamper = report.tamperAnalysis;
          if (!tamper) {
            return layer(13, reg.name, 'SKIPPED', 0, 'Tamper analysis not available', {}, Date.now() - t0);
          }
          const detected = tamper.vectors?.some((v) => v.detected) ?? tamper.overallTamperScore > 0;
          return layer(
            13,
            reg.name,
            'PASS',
            detected ? Math.min(100, tamper.overallTamperScore || 50) : 100,
            detected ? `Tamper signals: ${tamper.primaryVector}` : 'No tamper vectors detected',
            {
              primaryVector: tamper.primaryVector,
              overallTamperScore: tamper.overallTamperScore,
              detected,
            },
            Date.now() - t0,
          );
        }
        case 14: {
          // Recovery Evidence
          const recovered = report.identityRecoveryReport?.recovered
            ?? (report.identityRecovery?.enginesRecovered ?? 0) > 0;
          if (recovered) {
            return layer(14, reg.name, 'PASS', report.identityRecoveryReport?.evidenceConfidence
              ?? report.identityRecovery?.compositeScores.identityConfidence
              ?? 50, report.identityRecoveryReport?.message
              ?? report.identityRecovery?.message
              ?? 'Identity recovery evidence present', {
              enginesRecovered: report.identityRecovery?.enginesRecovered,
            }, Date.now() - t0);
          }
          return layer(14, reg.name, 'FAIL', 0, 'No recovery evidence', {}, Date.now() - t0);
        }
        case 15: {
          // Final Verdict — Acceptance Engine only
          const v = outcome.acceptanceVerdict;
          if (v === 'INSUFFICIENT_EVIDENCE') {
            return layer(15, reg.name, 'SKIPPED', 0, outcome.decisionReason, {
              verdict: v,
              policy: outcome.acceptancePolicyVersion,
            }, Date.now() - t0);
          }
          if (v === 'NOT_PINIT') {
            return layer(15, reg.name, 'FAIL', 0, outcome.decisionReason, {
              verdict: v,
              policy: outcome.acceptancePolicyVersion,
            }, Date.now() - t0);
          }
          return layer(15, reg.name, 'PASS', outcome.acceptanceConfidence, outcome.displayLabel, {
            verdict: v,
            policy: outcome.acceptancePolicyVersion,
            confidence: outcome.acceptanceConfidence,
          }, Date.now() - t0);
        }
        default:
          return layer(reg.id, reg.name, 'SKIPPED', 0, 'Unknown layer', {}, Date.now() - t0);
      }
    }),
  );

  // Guarantee exactly 15 — never missing
  while (layers.length < DNA_LAYER_COUNT) {
    const id = layers.length + 1;
    layers.push(layer(id, `Layer ${id}`, 'SKIPPED', 0, 'Padding slot', {}, 0));
  }

  return {
    dnaAlgorithmVersion: DNA_ALGORITHM_VERSION,
    layerCount: DNA_LAYER_COUNT,
    layers: layers.slice(0, DNA_LAYER_COUNT),
  };
}

/** Map standardized layers into manifest.layers shape */
export function toManifestLayers(
  bundle: StandardizedDnaBundle,
): Array<{
  layer: number;
  name: string;
  state: ChannelState;
  score: number;
  reason: string;
  evidence: Record<string, unknown>;
  duration: number;
  id: number;
  explanation?: string;
}> {
  return bundle.layers.map((l) => ({
    id: l.id,
    layer: l.id,
    name: l.name,
    state: l.status,
    score: l.score,
    reason: l.reason,
    evidence: l.evidence,
    duration: l.duration,
    explanation: l.reason,
  }));
}
