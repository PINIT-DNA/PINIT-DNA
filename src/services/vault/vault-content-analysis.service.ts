/**
 * Whole-file authenticity analysis for Vault Explorer Details + post-DNA UI.
 * Multi-engine fusion — NEVER label-only; always explains WHY via evidence[].
 */

import crypto from 'crypto';
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { forensicScannerService } from '../forensics/forensic-scanner.service';
import {
  extractTextFromPdf,
  extractTextFromDocx,
  extractTextFromPlain,
} from '../privacy/privacy-masking.service';
import {
  VERDICT_DISPLAY,
  type AuthenticityEngineResult,
  type AuthenticityEvidence,
  type AuthenticityScores,
  type AuthenticityVerdict,
  type ConfidenceLevel,
  type ContentCompositionPercent,
  type VaultContentAnalysis,
} from './authenticity.types';
import { probeAiGeneration } from './ai-generation.engine';

export type { VaultContentAnalysis, AuthenticityVerdict };
export { VERDICT_DISPLAY };

const COURSE_KEYWORDS = [
  'internship', 'offer letter', 'syllabus', 'assignment', 'course', 'curriculum',
  'lecture', 'semester', 'enrollment', 'university', 'college', 'exam',
  'project report', 'probation', 'terms and conditions',
];

const AI_SOFTWARE = [
  'midjourney', 'dall-e', 'dalle', 'stable diffusion', 'firefly', 'leonardo',
  'ideogram', 'imagen', 'flux', 'chatgpt', 'openai', 'generative',
];
const EDIT_SOFTWARE = [
  'photoshop', 'adobe', 'lightroom', 'gimp', 'canva', 'figma', 'affinity',
  'snapseed', 'picsart', 'pixelmator',
];

function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeDeepfakePercent(score: number | null | undefined): number {
  if (score == null || !Number.isFinite(score)) return 0;
  if (score <= 1) return clampPct(score * 100);
  return clampPct(score);
}

function fileCategory(mime: string, filename: string): string {
  const m = (mime || '').toLowerCase();
  const n = (filename || '').toLowerCase();
  if (m.startsWith('image/') || /\.(jpe?g|png|webp|heic|tiff?)$/i.test(n)) return 'IMAGE';
  if (m.startsWith('video/') || /\.(mp4|mov|webm)$/i.test(n)) return 'VIDEO';
  if (m.includes('pdf') || n.endsWith('.pdf')) return 'PDF';
  if (m.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return 'DOCX';
  if (m.includes('presentation') || n.endsWith('.pptx')) return 'PPTX';
  if (m.includes('text') || /\.(txt|html?|json|csv)$/i.test(n)) return 'TEXT';
  return 'OTHER';
}

function isImageLike(mimeType: string, filename: string): boolean {
  return fileCategory(mimeType, filename) === 'IMAGE';
}

function confidenceLevel(c: number): ConfidenceLevel {
  if (c >= 0.75) return 'HIGH';
  if (c >= 0.55) return 'MEDIUM';
  return 'LOW';
}

function mapEnsembleVerdict(v: string | undefined): AuthenticityVerdict | null {
  if (!v) return null;
  const allowed: AuthenticityVerdict[] = [
    'ORIGINAL', 'EDITED', 'TAMPERED', 'AI_GENERATED', 'LIKELY_AI', 'LIKELY_EDITED',
    'DEEPFAKE', 'SCREENSHOT', 'RECOMPRESSED', 'METADATA_MODIFIED', 'SUSPICIOUS', 'UNKNOWN',
  ];
  return allowed.includes(v as AuthenticityVerdict) ? (v as AuthenticityVerdict) : null;
}

async function extractPreviewText(buffer: Buffer, mimeType: string, filename: string): Promise<string> {
  const cat = fileCategory(mimeType, filename);
  try {
    if (cat === 'PDF') return (await extractTextFromPdf(buffer)).slice(0, 20_000);
    if (cat === 'DOCX') return (await extractTextFromDocx(buffer)).slice(0, 20_000);
    if (cat === 'TEXT') return extractTextFromPlain(buffer).slice(0, 20_000);
  } catch (err) {
    logger.warn('[Authenticity] text extract failed', { filename, error: err });
  }
  return '';
}

function findCourseKeywords(text: string, filename: string): string[] {
  const hay = `${filename}\n${text}`.toLowerCase();
  return COURSE_KEYWORDS.filter((k) => hay.includes(k));
}

interface MetaResult {
  engine: AuthenticityEngineResult;
  evidence: AuthenticityEvidence[];
  software: string | null;
  camera: string | null;
  missing: boolean;
  aiSoftwareHint: boolean;
  editSoftwareHint: boolean;
}

async function runMetadataEngine(
  buffer: Buffer,
  mimeType: string,
  filename: string,
): Promise<MetaResult> {
  const evidence: AuthenticityEvidence[] = [];
  let software: string | null = null;
  let camera: string | null = null;
  let missing = false;
  let aiSoftwareHint = false;
  let editSoftwareHint = false;

  if (!mimeType.startsWith('image/')) {
    return {
      engine: {
        id: 'metadata',
        name: 'Metadata Engine',
        status: 'SKIPPED',
        summary: 'EXIF metadata engine applies to images',
      },
      evidence,
      software,
      camera,
      missing: false,
      aiSoftwareHint,
      editSoftwareHint,
    };
  }

  try {
    const meta = await sharp(buffer).metadata();
    const exif = meta.exif;
    missing = !exif || exif.length < 32;
    software = (meta as { softWare?: string }).softWare
      ?? (typeof meta.xmp === 'object' ? null : null);

    // sharp doesn't always expose make/model; parse soft hints from density / format
    const format = meta.format ?? 'unknown';
    if (missing) {
      evidence.push({
        id: 'meta-missing',
        engine: 'metadata',
        severity: 'info',
        title: 'Missing / stripped metadata',
        detail: 'Little or no EXIF present — common after messaging apps, social re-export, or scrubbing. Not treated as tampering by itself.',
        scoreImpact: 0,
      });
    } else {
      evidence.push({
        id: 'meta-present',
        engine: 'metadata',
        severity: 'info',
        title: 'Embedded image metadata present',
        detail: `Container format ${format}; EXIF blob size ${exif?.length ?? 0} bytes.`,
      });
    }

    // Scan EXIF + leading container bytes for software signatures
    const blob = Buffer.concat([
      exif ?? Buffer.alloc(0),
      buffer.subarray(0, Math.min(buffer.length, 256_000)),
      Buffer.from(filename),
    ]).toString('latin1').toLowerCase();

    for (const s of AI_SOFTWARE) {
      if (blob.includes(s)) {
        aiSoftwareHint = true;
        software = software ?? s;
        evidence.push({
          id: `meta-ai-${s}`,
          engine: 'metadata',
          severity: 'high',
          title: 'AI software signature in metadata',
          detail: `Detected trace of "${s}" in metadata/filename — elevates AI probability.`,
          scoreImpact: 25,
        });
        break;
      }
    }
    for (const s of EDIT_SOFTWARE) {
      if (blob.includes(s)) {
        editSoftwareHint = true;
        software = software ?? s;
        evidence.push({
          id: `meta-edit-${s}`,
          engine: 'metadata',
          severity: 'medium',
          title: 'Editing software signature',
          detail: `Detected trace of "${s}" — file may have been edited or exported from an editor.`,
          scoreImpact: 15,
        });
        break;
      }
    }

    if (meta.space) {
      evidence.push({
        id: 'meta-colorspace',
        engine: 'metadata',
        severity: 'info',
        title: 'Color profile',
        detail: `Color space: ${meta.space}${meta.density ? `; density ${meta.density} DPI` : ''}.`,
      });
    }

    return {
      engine: {
        id: 'metadata',
        name: 'Metadata Engine',
        status: 'COMPLETE',
        summary: missing
          ? 'EXIF missing or stripped'
          : `Metadata present${software ? ` · software hint: ${software}` : ''}`,
        findings: evidence.map((e) => e.title),
      },
      evidence,
      software,
      camera,
      missing,
      aiSoftwareHint,
      editSoftwareHint,
    };
  } catch (err) {
    return {
      engine: {
        id: 'metadata',
        name: 'Metadata Engine',
        status: 'FAILED',
        summary: err instanceof Error ? err.message : 'Metadata parse failed',
      },
      evidence,
      software,
      camera,
      missing: true,
      aiSoftwareHint,
      editSoftwareHint,
    };
  }
}

function fuseVerdict(input: {
  isImage: boolean;
  isDocument: boolean;
  isVideo: boolean;
  deepfakePct: number;
  isDeepfake: boolean;
  aiGenScore: number;
  likelyAiGenerated: boolean;
  aiMarkerHit: boolean;
  hasCameraExif: boolean;
  pythonAiGenerated: boolean;
  pythonAiGeneratedPct: number;
  aiEdited: boolean | null;
  aiEditPct: number;
  isScreenshot: boolean;
  screenshotPct: number;
  courseHits: string[];
  aiSoftwareHint: boolean;
  editSoftwareHint: boolean;
  missingMeta: boolean;
  doubleJpegHint: boolean;
  elaMean: number | null;
  ensembleAiPct: number | null;
  ensembleTamperPct: number | null;
  ensembleAuthenticityPct: number | null;
  ensembleVerdict: AuthenticityVerdict | null;
  ensembleConfidence: number | null;
}): {
  verdict: AuthenticityVerdict;
  confidence: number;
  scores: AuthenticityScores;
  composition: ContentCompositionPercent;
} {
  let aiProbability = 0;
  let tamperScore = 0;

  // Production ensemble (CLIP + EfficientNet + FFT + PRNU + ELA) — primary when present
  if (input.ensembleAiPct != null && input.ensembleAiPct > 0) {
    aiProbability = Math.max(aiProbability, clampPct(input.ensembleAiPct));
  }
  // Ensemble tamper only counts when meaningful — mild residual scores are noise
  if (input.ensembleTamperPct != null && input.ensembleTamperPct >= 40) {
    tamperScore = Math.max(tamperScore, clampPct(input.ensembleTamperPct));
  }

  // Strong generative markers / CLIP
  if (input.aiMarkerHit) {
    aiProbability = Math.max(aiProbability, 88);
  } else if (input.pythonAiGenerated && input.pythonAiGeneratedPct >= 70) {
    aiProbability = Math.max(aiProbability, Math.min(96, input.pythonAiGeneratedPct));
  } else if (input.pythonAiGeneratedPct >= 55) {
    aiProbability = Math.max(aiProbability, Math.min(84, Math.round(input.pythonAiGeneratedPct * 0.9)));
  } else if (input.aiGenScore >= 65) {
    aiProbability = Math.max(aiProbability, Math.min(92, Math.round(50 + input.aiGenScore * 0.45)));
  } else if (input.aiGenScore >= 48) {
    aiProbability = Math.max(aiProbability, Math.min(78, Math.round(35 + input.aiGenScore * 0.5)));
  }

  // L11 deepfake only when actually flagged high
  if (input.isDeepfake && input.deepfakePct >= 70) {
    aiProbability = Math.max(aiProbability, Math.min(90, input.deepfakePct));
  }

  if (input.aiSoftwareHint) aiProbability = Math.max(aiProbability, 75);

  // Confusion-matrix style: "edited" only when engines agree (not missing EXIF)
  const elaElevated = input.elaMean != null && input.elaMean > 0.12;
  // Never trust a lone Python aiEdited flag when generative models say low-AI
  const trustPythonEdit =
    input.aiEdited === true
    && input.aiEditPct >= 55
    && (
      elaElevated
      || input.editSoftwareHint
      || ((input.ensembleTamperPct ?? 0) >= 50 && (input.ensembleAiPct ?? 0) >= 40)
      || ((input.pythonAiGeneratedPct ?? 0) >= 55)
    );
  const strongEditEvidence =
    trustPythonEdit
    || (input.editSoftwareHint && (elaElevated || (input.ensembleTamperPct ?? 0) >= 40))
    || (elaElevated && input.doubleJpegHint);

  if (strongEditEvidence) {
    tamperScore = Math.max(tamperScore, Math.min(75, Math.max(40, input.aiEditPct || (input.ensembleTamperPct ?? 45))));
  } else if (input.editSoftwareHint) {
    tamperScore = Math.max(tamperScore, 28);
  }
  // Missing EXIF alone — never inflate tamper
  if (input.doubleJpegHint && elaElevated) tamperScore = Math.max(tamperScore, 40);
  if (input.elaMean != null && input.elaMean > 0.15) {
    tamperScore = Math.max(tamperScore, clampPct(input.elaMean * 160));
  }

  if (input.hasCameraExif && input.aiGenScore < 35 && !input.aiMarkerHit && !input.isDeepfake) {
    aiProbability = clampPct(aiProbability * 0.45);
  }

  // Low-signal originals: dampen residual heuristic inflation
  const lowAiConsensus =
    input.aiGenScore < 35
    && input.deepfakePct < 35
    && (input.pythonAiGeneratedPct || 0) < 45
    && (input.ensembleAiPct == null || input.ensembleAiPct < 45)
    && !input.aiMarkerHit
    && !input.aiSoftwareHint;
  if (lowAiConsensus) {
    aiProbability = clampPct(Math.min(aiProbability, 28));
    if (!strongEditEvidence) {
      tamperScore = clampPct(Math.min(tamperScore, 22));
    }
  }

  const screenshotPercent = input.isScreenshot ? clampPct(Math.max(55, input.screenshotPct)) : 0;

  // Composition derived from scores — no invented 70% edited from weak flags
  let aiGeneratedPercent = 0;
  if (input.aiMarkerHit || input.pythonAiGeneratedPct >= 70 || (input.ensembleAiPct ?? 0) >= 70) {
    aiGeneratedPercent = clampPct(Math.max(55, aiProbability * 0.85));
  } else if (aiProbability >= 55 && (input.pythonAiGeneratedPct >= 55 || input.aiGenScore >= 55)) {
    aiGeneratedPercent = clampPct(Math.max(40, aiProbability * 0.7));
  } else if (aiProbability >= 40) {
    aiGeneratedPercent = clampPct(aiProbability * 0.35);
  }

  let editedPercent = strongEditEvidence
    ? clampPct(Math.min(55, Math.max(25, tamperScore * 0.55)))
    : 0;
  if (aiGeneratedPercent >= 50) editedPercent = clampPct(editedPercent * 0.35);

  let tamperedPercent = (input.doubleJpegHint && elaElevated) || (input.elaMean != null && input.elaMean > 0.18)
    ? clampPct(Math.max(tamperScore * 0.4, 15))
    : 0;
  const recompressedPercent = input.doubleJpegHint && elaElevated ? 25 : 0;

  let used = aiGeneratedPercent + editedPercent + screenshotPercent + tamperedPercent;
  if (used > 100) {
    const scale = 100 / used;
    aiGeneratedPercent = clampPct(aiGeneratedPercent * scale);
    editedPercent = clampPct(editedPercent * scale);
    used = aiGeneratedPercent + editedPercent + screenshotPercent + tamperedPercent;
  }
  const manualPercent = used === 0 ? 100 : clampPct(100 - used);

  let authenticityScore = clampPct(
    100 - Math.max(aiProbability * 0.7, tamperScore * 0.65, screenshotPercent * 0.25),
  );
  if (input.ensembleAuthenticityPct != null && input.ensembleConfidence != null && input.ensembleConfidence >= 0.55) {
    authenticityScore = clampPct(
      authenticityScore * 0.4 + input.ensembleAuthenticityPct * 0.6,
    );
  }

  let verdict: AuthenticityVerdict = 'UNKNOWN';
  let confidence = 0.45;

  if (input.isScreenshot && aiProbability < 55) {
    verdict = 'SCREENSHOT';
    confidence = Math.max(0.55, input.screenshotPct / 100);
  } else if (input.isDeepfake && input.deepfakePct >= 80 && input.aiGenScore < 50) {
    verdict = 'DEEPFAKE';
    confidence = Math.min(0.85, input.deepfakePct / 100);
  } else if (
    input.aiMarkerHit
    || (input.pythonAiGeneratedPct >= 70 && aiProbability >= 60)
    || (input.aiGenScore >= 65 && (input.pythonAiGeneratedPct >= 55 || (input.ensembleAiPct ?? 0) >= 55))
  ) {
    verdict = 'AI_GENERATED';
    confidence = Math.min(0.88, Math.max(0.62, aiProbability / 100));
  } else if (aiProbability >= 55 && (input.pythonAiGeneratedPct >= 55 || (input.ensembleAiPct ?? 0) >= 52)) {
    verdict = 'LIKELY_AI';
    confidence = Math.min(0.75, Math.max(0.55, aiProbability / 100));
  } else if (strongEditEvidence) {
    verdict = 'LIKELY_EDITED';
    confidence = Math.min(0.78, Math.max(0.55, tamperScore / 100));
  } else if (input.doubleJpegHint && elaElevated) {
    verdict = tamperScore >= 50 ? 'TAMPERED' : 'RECOMPRESSED';
    confidence = 0.6;
  } else if (input.courseHits.length >= 2) {
    verdict = 'COURSE_MATERIAL';
    confidence = Math.min(0.9, 0.55 + input.courseHits.length * 0.08);
  } else if (input.isDocument) {
    verdict = 'DOCUMENT';
    confidence = 0.7;
  } else if (input.isImage || input.isVideo) {
    // Prefer ORIGINAL when models disagree or all weak
    verdict = lowAiConsensus || (aiProbability < 40 && tamperScore < 35)
      ? 'ORIGINAL'
      : 'SUSPICIOUS';
    confidence = verdict === 'ORIGINAL'
      ? (aiProbability > 25 ? 0.62 : 0.82)
      : 0.5;
  } else {
    verdict = 'UNKNOWN';
    confidence = 0.4;
  }

  // Ensemble override only when confident AND classifier-aligned
  if (
    input.ensembleVerdict
    && input.ensembleConfidence != null
    && input.ensembleConfidence >= 0.62
    && input.ensembleAiPct != null
    && input.ensembleAiPct >= 55
    && ['AI_GENERATED', 'LIKELY_AI', 'TAMPERED', 'EDITED'].includes(input.ensembleVerdict)
  ) {
    verdict = input.ensembleVerdict;
    confidence = Math.max(confidence, input.ensembleConfidence);
    aiProbability = Math.max(aiProbability, input.ensembleAiPct);
    if (input.ensembleTamperPct != null) {
      tamperScore = Math.max(tamperScore, input.ensembleTamperPct);
    }
    if (input.ensembleAuthenticityPct != null) {
      authenticityScore = input.ensembleAuthenticityPct;
    }
  } else if (
    input.ensembleVerdict === 'ORIGINAL'
    && (input.ensembleConfidence ?? 0) >= 0.55
    && lowAiConsensus
    && !strongEditEvidence
  ) {
    verdict = 'ORIGINAL';
    confidence = Math.max(confidence, input.ensembleConfidence ?? 0.6);
    if (input.ensembleAuthenticityPct != null) {
      authenticityScore = Math.max(authenticityScore, input.ensembleAuthenticityPct);
    }
  }

  return {
    verdict,
    confidence,
    scores: {
      authenticityScore,
      tamperScore: clampPct(tamperScore),
      aiProbability: clampPct(aiProbability),
      confidence: Math.round(confidence * 100) / 100,
      confidenceLevel: confidenceLevel(confidence),
    },
    composition: {
      manualPercent,
      aiGeneratedPercent,
      editedPercent,
      screenshotPercent,
      courseMaterialPercent: input.courseHits.length === 0
        ? 0
        : clampPct(Math.min(95, 35 + input.courseHits.length * 12)),
      tamperedPercent,
      recompressedPercent,
    },
  };
}

export const vaultContentAnalysisService = {
  async analyzeAndStore(params: {
    vaultId: string;
    dnaRecordId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<VaultContentAnalysis | null> {
    if (!isImageLike(params.mimeType, params.filename)) {
      await prisma.vaultRecord.update({
        where: { id: params.vaultId },
        data: {
          contentLabel: null,
          contentAnalysis: null,
        },
      });
      await prisma.dnaRecord.update({
        where: { id: params.dnaRecordId },
        data: {
          fileAnalysisLabel: null,
          fileAnalysis: null,
        },
      }).catch(() => {});
      return null;
    }
    try {
      const analysis = await this.analyze(params);
      await prisma.vaultRecord.update({
        where: { id: params.vaultId },
        data: {
          contentLabel: analysis.verdict,
          contentAnalysis: analysis as object,
        },
      });
      await prisma.dnaRecord.update({
        where: { id: params.dnaRecordId },
        data: {
          fileAnalysisLabel: analysis.verdict,
          fileAnalysis: analysis as object,
        },
      }).catch(() => {});
      logger.info('[Authenticity] stored on vault', {
        vaultId: params.vaultId,
        verdict: analysis.verdict,
        scores: analysis.scores,
      });
      return analysis;
    } catch (err) {
      logger.warn('[Authenticity] vault store failed', { error: err });
      return null;
    }
  },

  async analyzeAndStoreOnDna(params: {
    dnaRecordId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<VaultContentAnalysis | null> {
    if (!isImageLike(params.mimeType, params.filename)) {
      await prisma.dnaRecord.update({
        where: { id: params.dnaRecordId },
        data: {
          fileAnalysisLabel: null,
          fileAnalysis: null,
        },
      }).catch(() => {});
      return null;
    }
    try {
      const analysis = await this.analyze(params);
      await prisma.dnaRecord.update({
        where: { id: params.dnaRecordId },
        data: {
          fileAnalysisLabel: analysis.verdict,
          fileAnalysis: analysis as object,
        },
      });
      logger.info('[Authenticity] stored on DNA', {
        dnaRecordId: params.dnaRecordId,
        verdict: analysis.verdict,
        scores: analysis.scores,
      });
      return analysis;
    } catch (err) {
      logger.warn('[Authenticity] DNA store failed', { error: err });
      return null;
    }
  },

  async copyDnaAnalysisToVault(vaultId: string, dnaRecordId: string): Promise<boolean> {
    try {
      const dna = await prisma.dnaRecord.findUnique({
        where: { id: dnaRecordId },
        select: { fileAnalysis: true, fileAnalysisLabel: true },
      });
      if (!dna?.fileAnalysis) return false;
      await prisma.vaultRecord.update({
        where: { id: vaultId },
        data: {
          contentLabel: dna.fileAnalysisLabel ?? null,
          contentAnalysis: dna.fileAnalysis as object,
        },
      });
      return true;
    } catch {
      return false;
    }
  },

  async analyze(params: {
    dnaRecordId: string;
    buffer: Buffer;
    mimeType: string;
    filename: string;
  }): Promise<VaultContentAnalysis> {
    const { dnaRecordId, buffer, mimeType, filename } = params;
    const cat = fileCategory(mimeType, filename);
    const isImage = cat === 'IMAGE';
    const isDocument = ['PDF', 'DOCX', 'PPTX', 'TEXT'].includes(cat);
    const isVideo = cat === 'VIDEO';
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const evidence: AuthenticityEvidence[] = [];
    const engines: AuthenticityEngineResult[] = [];
    const source: string[] = ['sha256', 'mime-filename'];
    const reasons: string[] = [];

    evidence.push({
      id: 'hash-sha256',
      engine: 'cryptographic',
      severity: 'info',
      title: 'Content hash (SHA-256)',
      detail: sha256,
    });

    // ── Metadata engine ──────────────────────────────────────────────────
    const meta = await runMetadataEngine(buffer, mimeType, filename);
    engines.push(meta.engine);
    evidence.push(...meta.evidence);
    source.push('metadata');

    // ── AI-generation probe (decoded pixels + markers) ───────────────────
    let aiGenScore = 0;
    let likelyAiGenerated = false;
    let aiMarkerHit = false;
    let hasCameraExif = false;
    if (isImage) {
      const aiProbe = await probeAiGeneration(buffer, mimeType, filename);
      source.push('ai-generation-probe');
      aiGenScore = aiProbe.score;
      likelyAiGenerated = aiProbe.likelyAiGenerated;
      aiMarkerHit = !!aiProbe.markerHit;
      hasCameraExif = aiProbe.hasCameraExif;
      engines.push(aiProbe.engine);
      evidence.push(...aiProbe.evidence);
      if (aiProbe.markerHit || aiProbe.reasons.length) {
        reasons.push(
          ...(aiProbe.markerHit
            ? [`AI marker: ${aiProbe.markerHit}`]
            : aiProbe.reasons.slice(0, 3)),
        );
      }
      if (aiProbe.markerHit) {
        meta.aiSoftwareHint = true;
      }
    } else {
      engines.push({
        id: 'ai-generation',
        name: 'AI Generated Detection',
        status: 'SKIPPED',
        summary: 'Applies to images',
      });
    }

    // ── Layer 11 deepfake (Node heuristic) ───────────────────────────────
    const deepfake = await prisma.deepfakeLayer.findUnique({
      where: { dnaRecordId },
      select: { deepfakeScore: true, isDeepfake: true, confidence: true, flagged: true },
    });
    let deepfakePct = 0;
    let isDeepfake = false;
    if (deepfake) {
      source.push('dna-layer-11');
      deepfakePct = normalizeDeepfakePercent(deepfake.deepfakeScore);
      isDeepfake = deepfake.isDeepfake === true || deepfake.flagged === true;
      engines.push({
        id: 'deepfake-l11',
        name: 'Deepfake / AI Heuristic (L11)',
        status: 'COMPLETE',
        summary: isDeepfake
          ? `Flagged — score ${deepfakePct}/100`
          : `Clear — score ${deepfakePct}/100`,
        score: deepfakePct,
        findings: [
          isDeepfake
            ? `Heuristic deepfake flag at ${deepfakePct}/100`
            : `No deepfake flag (score ${deepfakePct}/100)`,
        ],
      });
      evidence.push({
        id: 'l11-score',
        engine: 'deepfake-l11',
        severity: isDeepfake ? 'high' : 'info',
        title: isDeepfake ? 'Deepfake heuristic flagged' : 'Deepfake heuristic clear',
        detail: `Layer-11 multi-factor noise/quantization/channel score = ${deepfakePct}/100. This is a heuristic, not a generative-model classifier.`,
        scoreImpact: isDeepfake ? 20 : 0,
      });
      reasons.push(
        isDeepfake
          ? `Deepfake layer flagged (score ${deepfakePct}/100)`
          : `Deepfake layer clear (score ${deepfakePct}/100)`,
      );
    } else {
      engines.push({
        id: 'deepfake-l11',
        name: 'Deepfake / AI Heuristic (L11)',
        status: 'SKIPPED',
        summary: 'No Layer-11 row for this DNA record',
      });
    }

    // ── Pixel / forensic scanner (ELA, AI edit, screenshot) ───────────────
    let aiEdited: boolean | null = null;
    let aiEditPct = 0;
    let pythonAiGenerated = false;
    let pythonAiGeneratedPct = 0;
    let isScreenshot = false;
    let screenshotPct = 0;
    let screenshotPlatform: string | null = null;
    let doubleJpegHint = false;
    let elaMean: number | null = null;
    let ensembleAiPct: number | null = null;
    let ensembleTamperPct: number | null = null;
    let ensembleAuthenticityPct: number | null = null;
    let ensembleVerdict: AuthenticityVerdict | null = null;
    let ensembleConfidence: number | null = null;
    let heatmapPngBase64: string | null = null;

    if (isImage) {
      const scan = await forensicScannerService.scanProbe(buffer, mimeType);
      if (scan.available) {
        source.push('forensic-scanner');
        const findings: string[] = [];

        if (scan.authenticityEnsemble) {
          source.push('authenticity-ensemble');
          const ens = scan.authenticityEnsemble;
          ensembleAiPct = ens.aiProbability ?? ens.generatedConfidencePercent ?? null;
          ensembleTamperPct = ens.tamperScore ?? null;
          ensembleAuthenticityPct = ens.authenticityScore ?? null;
          ensembleVerdict = mapEnsembleVerdict(ens.verdict);
          ensembleConfidence = ens.confidence ?? null;
          heatmapPngBase64 = ens.heatmapPngBase64 ?? null;
          pythonAiGenerated = !!ens.aiGenerated;
          pythonAiGeneratedPct = ens.generatedConfidencePercent ?? ensembleAiPct ?? 0;

          if (Array.isArray(ens.engines)) {
            for (const eng of ens.engines) {
              engines.push({
                id: eng.id,
                name: eng.name,
                status: eng.status as AuthenticityEngineResult['status'],
                summary: eng.summary ?? '',
                score: eng.score ?? null,
                findings: eng.findings,
              });
            }
          }
          if (Array.isArray(ens.evidence)) {
            for (const e of ens.evidence) {
              evidence.push({
                id: e.id,
                engine: e.engine,
                severity: e.severity as AuthenticityEvidence['severity'],
                title: e.title,
                detail: e.detail,
                scoreImpact: e.scoreImpact,
              });
            }
          }
          if (Array.isArray(ens.reasons)) {
            reasons.push(...ens.reasons.slice(0, 8));
          }
          engines.push({
            id: 'authenticity-ensemble',
            name: 'Production Authenticity Ensemble',
            status: 'COMPLETE',
            summary:
              `AI ${ensembleAiPct ?? 0}% · Tamper ${ensembleTamperPct ?? 0}% · ` +
              `Authenticity ${ensembleAuthenticityPct ?? 0}%`,
            score: ensembleAiPct ?? undefined,
            findings: ens.reasons?.slice(0, 4),
          });
        }

        if (scan.aiManipulation) {
          aiEdited = scan.aiManipulation.aiEdited ?? null;
          aiEditPct = scan.aiManipulation.confidencePercent ?? 0;
          pythonAiGenerated = !!scan.aiManipulation.aiGenerated;
          pythonAiGeneratedPct = Math.max(
            pythonAiGeneratedPct,
            scan.aiManipulation.generatedConfidencePercent ?? 0,
          );

          // False-positive gate: Python heuristic often flags real photos (no EXIF / clean ELA).
          // Only trust aiEdited when ELA is elevated OR classifier AI is also high.
          const elaFromScan = typeof (scan.features as Record<string, unknown> | undefined)?.['elaMean'] === 'number'
            ? Number((scan.features as Record<string, unknown>)['elaMean'])
            : null;
          const weakClassifier =
            (ensembleAiPct == null || ensembleAiPct < 45)
            && aiGenScore < 40
            && deepfakePct < 40
            && !aiMarkerHit;
          const elaSupportsEdit = elaFromScan != null && elaFromScan > 0.12;
          if (aiEdited === true && weakClassifier && !elaSupportsEdit) {
            evidence.push({
              id: 'pixel-ai-edit-rejected',
              engine: 'pixel-forensics',
              severity: 'info',
              title: 'Weak edit flag ignored',
              detail:
                `Python edit heuristic reported ${aiEditPct}% but CLIP/ensemble AI is low ` +
                `(${ensembleAiPct ?? 0}%) and ELA is not elevated — treating as original-leaning.`,
              scoreImpact: 0,
            });
            aiEdited = false;
            aiEditPct = Math.min(aiEditPct, 25);
          }

          findings.push(
            aiEdited
              ? `AI manipulation likely (${aiEditPct}%)`
              : 'No strong AI manipulation signal',
          );
          if (pythonAiGeneratedPct > 0) {
            findings.push(
              pythonAiGenerated
                ? `CLIP / forensic AI-generation signal (${pythonAiGeneratedPct}%)`
                : `Weak AI-generation signal (${pythonAiGeneratedPct}%)`,
            );
          }
          evidence.push({
            id: 'pixel-ai-edit',
            engine: 'pixel-forensics',
            severity: aiEdited ? 'high' : 'info',
            title: aiEdited ? 'Pixel forensics: AI-edit signals' : 'Pixel forensics: no AI-edit signals',
            detail: scan.aiManipulation.reason
              ?? (aiEdited
                ? `ELA / noise / region heuristics suggest AI editing (${aiEditPct}%).`
                : 'Forensic scan did not find strong AI-edit patterns.'),
            scoreImpact: aiEdited ? 18 : 0,
          });
          for (const r of scan.aiManipulation.reasons ?? []) {
            evidence.push({
              id: `pixel-reason-${evidence.length}`,
              engine: 'pixel-forensics',
              severity: 'medium',
              title: 'Forensic finding',
              detail: r,
            });
          }
          reasons.push(
            aiEdited
              ? `AI manipulation signals (${aiEditPct}%)`
              : 'No strong AI manipulation signals from forensic scan',
          );
          if (pythonAiGeneratedPct >= 55) {
            evidence.push({
              id: 'python-ai-generated',
              engine: 'pixel-forensics',
              severity: pythonAiGeneratedPct >= 70 ? 'high' : 'medium',
              title: pythonAiGenerated ? 'AI-generated image signal' : 'Possible AI-generated image signal',
              detail: `Python CLIP + forensic scan estimated AI-generation likelihood at ${pythonAiGeneratedPct}%.`,
              scoreImpact: pythonAiGeneratedPct >= 70 ? 24 : 12,
            });
            reasons.push(`AI-generation signal from CLIP/forensics (${pythonAiGeneratedPct}%)`);
          }
        }
        if (scan.screenshotDetection) {
          isScreenshot = !!scan.screenshotDetection.isScreenshot;
          screenshotPct = scan.screenshotDetection.confidencePercent ?? 0;
          screenshotPlatform = scan.screenshotDetection.platform ?? null;
          findings.push(
            isScreenshot
              ? `Screenshot likely (${screenshotPlatform ?? 'unknown platform'}, ${screenshotPct}%)`
              : 'Not classified as screenshot',
          );
          if (isScreenshot) {
            evidence.push({
              id: 'screenshot',
              engine: 'screenshot',
              severity: 'medium',
              title: 'Screenshot / re-capture detected',
              detail: `Platform hint: ${screenshotPlatform ?? 'n/a'}; confidence ${screenshotPct}%.`,
              scoreImpact: 15,
            });
            reasons.push(`Screenshot detected${screenshotPlatform ? ` (${screenshotPlatform})` : ''}`);
          }
        }
        const features = scan.features as Record<string, unknown> | undefined;
        if (features) {
          if (typeof features['elaMean'] === 'number') elaMean = features['elaMean'] as number;
          if (features['doubleJpeg'] === true || features['doubleCompression'] === true) {
            doubleJpegHint = true;
            evidence.push({
              id: 'double-jpeg',
              engine: 'pixel-forensics',
              severity: 'medium',
              title: 'Double JPEG / recompression hint',
              detail: 'Compression artifact pattern consistent with re-saving or re-encoding.',
              scoreImpact: 12,
            });
            reasons.push('Double JPEG / recompression hint');
          }
        }
        engines.push({
          id: 'pixel-forensics',
          name: 'Pixel Forensics (ELA / noise / AI-edit)',
          status: 'COMPLETE',
          summary: findings.join(' · ') || 'Scan complete',
          findings,
        });
        engines.push({
          id: 'screenshot',
          name: 'Screenshot / Re-capture Engine',
          status: 'COMPLETE',
          summary: isScreenshot ? `Screenshot (${screenshotPct}%)` : 'Not a screenshot',
          score: screenshotPct,
        });
      } else {
        engines.push({
          id: 'pixel-forensics',
          name: 'Pixel Forensics (ELA / noise / AI-edit)',
          status: 'UNAVAILABLE',
          summary: 'Python forensic scanner offline — used DNA heuristics only',
        });
        reasons.push('Forensic scanner unavailable — used DNA / heuristics only');
      }
    } else {
      engines.push({
        id: 'pixel-forensics',
        name: 'Pixel Forensics',
        status: 'SKIPPED',
        summary: 'Applies to images',
      });
    }

    // ── Document / OCR-lite text engine ───────────────────────────────────
    let courseHits: string[] = [];
    let wordCount: number | null = null;
    if (isDocument || cat === 'OTHER') {
      const text = await extractPreviewText(buffer, mimeType, filename);
      const words = text.split(/\s+/).filter(Boolean);
      wordCount = words.length || null;
      courseHits = findCourseKeywords(text, filename);
      source.push('text-extract');
      engines.push({
        id: 'document-text',
        name: 'Document / Text Analysis',
        status: words.length ? 'COMPLETE' : 'PARTIAL',
        summary: words.length
          ? `Extracted ~${words.length} words${courseHits.length ? `; course keywords: ${courseHits.slice(0, 3).join(', ')}` : ''}`
          : 'Little or no extractable text',
        findings: courseHits.length
          ? [`Course/academic keywords: ${courseHits.join(', ')}`]
          : ['No strong course-keyword hits'],
      });
      if (words.length) {
        evidence.push({
          id: 'doc-text',
          engine: 'document-text',
          severity: 'info',
          title: 'Text extracted for classification',
          detail: `~${words.length} words analyzed for academic/course patterns.`,
        });
        reasons.push(`Extracted ~${words.length} words for content classification`);
      }
      if (courseHits.length) {
        evidence.push({
          id: 'doc-course',
          engine: 'document-text',
          severity: 'info',
          title: 'Course / academic content signals',
          detail: `Keywords: ${courseHits.slice(0, 6).join(', ')}`,
        });
        reasons.push(`Course/academic keywords: ${courseHits.slice(0, 5).join(', ')}`);
      }
    } else {
      engines.push({
        id: 'document-text',
        name: 'Document / Text Analysis',
        status: 'SKIPPED',
        summary: 'Not a text/document file',
      });
    }

    // Planned engines (architecture hooks — honest status)
    for (const [id, name] of [
      ['semantic-vision', 'Semantic / Vision LLM'],
      ['logo-seal', 'Logo & Seal Verification'],
      ['reverse-image', 'Reverse Image Search'],
      ['pdf-object-stream', 'PDF Object-Stream Forensics'],
    ] as const) {
      engines.push({
        id,
        name,
        status: 'UNAVAILABLE',
        summary: 'Module scaffolded — enable when model/API credentials are configured',
      });
    }

    const fused = fuseVerdict({
      isImage,
      isDocument,
      isVideo,
      deepfakePct,
      isDeepfake,
      aiGenScore,
      likelyAiGenerated,
      aiMarkerHit,
      hasCameraExif,
      pythonAiGenerated,
      pythonAiGeneratedPct,
      aiEdited,
      aiEditPct,
      isScreenshot,
      screenshotPct,
      courseHits,
      aiSoftwareHint: meta.aiSoftwareHint,
      editSoftwareHint: meta.editSoftwareHint,
      missingMeta: meta.missing,
      doubleJpegHint,
      elaMean,
      ensembleAiPct,
      ensembleTamperPct,
      ensembleAuthenticityPct,
      ensembleVerdict,
      ensembleConfidence,
    });

    if (fused.verdict === 'AI_GENERATED' || fused.verdict === 'LIKELY_AI') {
      reasons.push(
        `AI probability ${fused.scores.aiProbability}% (generation probe ${aiGenScore}/100` +
        `${aiMarkerHit ? ', marker hit' : ''})`,
      );
    } else if (fused.verdict === 'ORIGINAL') {
      reasons.push(
        `Treated as original (AI probe ${aiGenScore}/100, deepfake ${deepfakePct}/100)`,
      );
    }

    const analysis: VaultContentAnalysis = {
      version: 'authenticity-v7',
      label: fused.verdict,
      labelDisplay: VERDICT_DISPLAY[fused.verdict],
      verdict: fused.verdict,
      verdictDisplay: VERDICT_DISPLAY[fused.verdict],
      confidence: fused.confidence,
      summary:
        `${VERDICT_DISPLAY[fused.verdict]} · Authenticity ${fused.scores.authenticityScore}% · ` +
        `Tamper ${fused.scores.tamperScore}% · AI ${fused.scores.aiProbability}% · ` +
        `Confidence ${fused.scores.confidenceLevel}`,
      scores: fused.scores,
      composition: fused.composition,
      evidence: evidence.slice(0, 40),
      engines,
      reasons: reasons.slice(0, 16),
      signals: {
        fileCategory: cat,
        mimeType,
        isImage,
        isDocument,
        isVideo,
        deepfakeScore: deepfake?.deepfakeScore ?? null,
        isDeepfake,
        aiEdited,
        aiConfidencePercent: aiEditPct || null,
        pythonAiGenerated,
        pythonAiGeneratedPct,
        isScreenshot,
        screenshotPlatform,
        screenshotConfidencePercent: screenshotPct || null,
        wordCount,
        courseKeywordsHit: courseHits,
        metadataMissing: meta.missing,
        metadataSoftware: meta.software,
        metadataCamera: meta.camera,
        doubleJpegHint,
        elaMean,
        sha256,
        aiGenerationScore: aiGenScore,
        likelyAiGenerated,
        aiMarkerHit,
        hasCameraExif,
        ensembleAiPct,
        ensembleTamperPct,
      },
      heatmapPngBase64,
      analyzedAt: new Date().toISOString(),
      source,
    };

    return analysis;
  },

  async reanalyzeVault(vaultId: string, buffer: Buffer): Promise<VaultContentAnalysis | null> {
    const record = await prisma.vaultRecord.findUnique({
      where: { id: vaultId },
      select: { id: true, dnaRecordId: true, originalMimeType: true, originalFileName: true },
    });
    if (!record) return null;
    return this.analyzeAndStore({
      vaultId: record.id,
      dnaRecordId: record.dnaRecordId,
      buffer,
      mimeType: record.originalMimeType,
      filename: record.originalFileName,
    });
  },
};
