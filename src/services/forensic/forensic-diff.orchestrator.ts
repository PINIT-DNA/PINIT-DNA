/**
 * PINIT-DNA — Forensic Diff Orchestrator
 *
 * Runs all diff engines in parallel and produces a single
 * comprehensive forensic difference report.
 */

import { v4 as uuidv4 } from 'uuid';
import { TextDiffService }     from './text-diff.service';
import { ImageDiffService }    from './image-diff.service';
import { MetadataDiffService } from './metadata-diff.service';
import { logger }              from '../../lib/logger';
import { FileTypeDetector }    from '../file-type-detector';
import type {
  ForensicDiffReport, ForensicSeverity, ForensicEvidence,
} from '../../types/forensic-diff.types';
import type { FileInput } from '../universal-file-router';

const textDiff     = new TextDiffService();
const imageDiff    = new ImageDiffService();
const metaDiff     = new MetadataDiffService();
const typeDetector = new FileTypeDetector();

// ─── Severity Calculator ──────────────────────────────────────────────────────

function calculateSeverity(
  textChange: number,      // 0–100 % text changed
  pixelChange: number,     // 0–100 % pixels changed
  metaChanges: number,     // count of metadata changes
  authorshipChanged: boolean,
  locationChanged: boolean,
): ForensicSeverity {
  if (authorshipChanged && (textChange > 10 || pixelChange > 10)) return 'CRITICAL';
  if (textChange > 50 || pixelChange > 50) return 'CRITICAL';
  if (textChange > 20 || pixelChange > 20) return 'HIGH';
  if (authorshipChanged || locationChanged) return 'HIGH';
  if (textChange > 5  || pixelChange > 5)  return 'MEDIUM';
  if (metaChanges > 3 || textChange > 1)   return 'MEDIUM';
  if (metaChanges > 0 || textChange > 0 || pixelChange > 0) return 'LOW';
  return 'NONE';
}

function classifyChange(
  textChange: number,
  pixelChange: number,
  metaChanges: number,
  resized: boolean,
  cropped: boolean,
  compressed: boolean,
): string {
  if (textChange === 0 && pixelChange === 0 && metaChanges === 0) return 'Identical Files';
  if (textChange === 0 && pixelChange === 0) return 'Metadata Only Modification';
  if (textChange > 0  && pixelChange === 0 && metaChanges <= 1)   return 'Text Content Modified';
  if (textChange === 0 && pixelChange > 0  && metaChanges === 0)  {
    if (resized) return 'Image Resized';
    if (cropped) return 'Image Cropped';
    if (compressed) return 'Compression/Quality Change';
    return 'Pixel-Level Modification';
  }
  if (textChange < 5  && pixelChange === 0) return 'Minor Text Edit';
  if (textChange > 20 || pixelChange > 20) return 'Major Content Overhaul';
  return 'Multi-Layer Modification';
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export class ForensicDiffOrchestrator {
  async analyze(fileA: FileInput, fileB: FileInput): Promise<ForensicDiffReport> {
    const start  = Date.now();
    const diffId = uuidv4();

    logger.info('Forensic diff started', {
      diffId, fileA: fileA.originalName, fileB: fileB.originalName,
    });

    // Detect file types
    const [detA, detB] = await Promise.all([
      typeDetector.detect(fileA.buffer, fileA.originalName, fileA.declaredMimeType).catch(() => ({ fileType: 'UNKNOWN', mimeType: fileA.declaredMimeType })),
      typeDetector.detect(fileB.buffer, fileB.originalName, fileB.declaredMimeType).catch(() => ({ fileType: 'UNKNOWN', mimeType: fileB.declaredMimeType })),
    ]);

    const mimeA = detA.mimeType;
    const mimeB = detB.mimeType;
    // Use the dominant MIME for diff (fileA's type takes precedence)
    const primaryMime = mimeA;

    // Run all engines in parallel
    const [textResult, imageResult, metaResult] = await Promise.all([
      textDiff.diff(fileA.buffer, fileB.buffer, primaryMime).catch(err => {
        logger.warn('Text diff failed', { error: String(err) });
        return null;
      }),
      imageDiff.diff(fileA.buffer, fileB.buffer, primaryMime).catch(() => null),
      metaDiff.diff(fileA.buffer, fileB.buffer, primaryMime).catch(() => null),
    ]);

    const processingMs = Date.now() - start;

    // ── Collect evidence ────────────────────────────────────────────────────
    const evidence: ForensicEvidence[] = [];

    // Text evidence
    if (textResult?.supported && textResult.changePercent > 0) {
      const sev: ForensicSeverity = textResult.changePercent > 20 ? 'HIGH'
        : textResult.changePercent > 5 ? 'MEDIUM' : 'LOW';
      evidence.push({
        category: 'Text Content',
        finding:  `${textResult.addedLines} lines added, ${textResult.removedLines} lines removed (${textResult.changePercent}% of text changed)`,
        location: textResult.sectionDiffs.length > 0
          ? textResult.sectionDiffs.slice(0, 3).map(s => s.sectionName).join(', ')
          : `Line-level differences throughout document`,
        severity:   sev,
        confidence: 0.95,
      });

      // Top added/removed snippets as individual evidence
      if (textResult.addedContent.length > 0) {
        evidence.push({
          category: 'Added Content',
          finding:  `New content added: "${textResult.addedContent[0].slice(0, 100)}${textResult.addedContent[0].length > 100 ? '…' : ''}"`,
          location: 'Document body',
          severity: textResult.addedWords > 50 ? 'HIGH' : 'MEDIUM',
          confidence: 0.90,
        });
      }
      if (textResult.removedContent.length > 0) {
        evidence.push({
          category: 'Removed Content',
          finding:  `Content removed: "${textResult.removedContent[0].slice(0, 100)}${textResult.removedContent[0].length > 100 ? '…' : ''}"`,
          location: 'Document body',
          severity: textResult.removedWords > 50 ? 'HIGH' : 'MEDIUM',
          confidence: 0.90,
        });
      }
    }

    // Image evidence
    if (imageResult?.supported) {
      if (imageResult.pixelDifferencePercent > 0.1) {
        const sev: ForensicSeverity = imageResult.pixelDifferencePercent > 20 ? 'HIGH'
          : imageResult.pixelDifferencePercent > 5 ? 'MEDIUM' : 'LOW';
        evidence.push({
          category: 'Image Pixels',
          finding:  `${imageResult.pixelDifferencePercent}% of pixels differ across ${imageResult.changedRegions.length} grid regions`,
          location: imageResult.changedRegions.slice(0, 3)
            .map(r => `Region (${r.gridCol},${r.gridRow})`)
            .join(', '),
          severity:   sev,
          confidence: 0.95,
        });
      }
      if (imageResult.resizeDetected) {
        evidence.push({
          category: 'Image Structure',
          finding:  `Image dimensions changed from ${imageResult.widthA}×${imageResult.heightA} to ${imageResult.widthB}×${imageResult.heightB}`,
          location: 'Entire image',
          severity: 'MEDIUM',
          confidence: 1.0,
        });
      }
      if (imageResult.cropDetected) {
        evidence.push({
          category: 'Image Structure',
          finding:  'Aspect ratio changed — possible crop or pad operation',
          location: 'Image boundaries',
          severity: 'HIGH',
          confidence: 0.85,
        });
      }
    }

    // Metadata evidence
    if (metaResult && metaResult.totalChanges > 0) {
      for (const change of metaResult.changes.slice(0, 5)) {
        const sev: ForensicSeverity = change.significance === 'high' ? 'HIGH'
          : change.significance === 'medium' ? 'MEDIUM' : 'LOW';
        evidence.push({
          category: 'Metadata',
          finding:  change.forensicNote,
          location: `Metadata field: ${change.field}`,
          severity: sev,
          confidence: 0.98,
        });
      }
    }

    // ── Severity ────────────────────────────────────────────────────────────
    const textChange  = textResult?.changePercent ?? 0;
    const pixelChange = imageResult?.pixelDifferencePercent ?? 0;
    const metaCount   = metaResult?.totalChanges ?? 0;

    const severity = calculateSeverity(
      textChange, pixelChange, metaCount,
      metaResult?.authorshipChanged ?? false,
      metaResult?.locationChanged ?? false,
    );

    const changeClass = classifyChange(
      textChange, pixelChange, metaCount,
      imageResult?.resizeDetected ?? false,
      imageResult?.cropDetected ?? false,
      imageResult?.compressionChanged ?? false,
    );

    // ── Confidence ──────────────────────────────────────────────────────────
    let confidence = 0.90;
    if (textResult?.supported)  confidence = Math.max(confidence, 0.95);
    if (imageResult?.supported) confidence = Math.max(confidence, 0.95);
    if (metaResult?.totalChanges) confidence = Math.min(confidence + 0.03, 0.99);

    // ── Human-readable report ───────────────────────────────────────────────
    const whatChanged: string[] = [];
    const whereChanged: string[] = [];
    const howChanged: string[] = [];

    if (textResult?.supported && textResult.changePercent > 0) {
      whatChanged.push(`Text content (${textResult.changePercent}% changed, ${textResult.addedLines} lines added, ${textResult.removedLines} lines removed)`);
      if (textResult.sectionDiffs.length > 0) {
        whereChanged.push(...textResult.sectionDiffs.slice(0, 3).map(s => `${s.sectionName} (${s.changePercent}% changed)`));
      }
      howChanged.push(`Lines were ${textResult.addedLines > 0 ? 'inserted' : ''}${textResult.removedLines > 0 ? (textResult.addedLines > 0 ? ' and ' : '') + 'deleted' : ''}`);
    }

    if (imageResult?.supported && imageResult.pixelDifferencePercent > 0.1) {
      whatChanged.push(`Image pixels (${imageResult.pixelDifferencePercent}% changed)`);
      whereChanged.push(`${imageResult.changedRegions.length} image regions`);
      if (imageResult.resizeDetected) {
        howChanged.push(`Image resized from ${imageResult.widthA}×${imageResult.heightA} to ${imageResult.widthB}×${imageResult.heightB}`);
      }
      if (imageResult.cropDetected) howChanged.push('Image was cropped');
      if (imageResult.compressionChanged) howChanged.push('Compression/quality was changed');
    }

    if (metaResult && metaResult.totalChanges > 0) {
      whatChanged.push(`Metadata (${metaResult.totalChanges} fields changed)`);
      whereChanged.push('File metadata properties');
      if (metaResult.authorshipChanged) howChanged.push('Author/creator information was modified');
      if (metaResult.timestampChanged)  howChanged.push('Creation/modification timestamps were altered');
    }

    const summary = whatChanged.length === 0
      ? `Files "${fileA.originalName}" and "${fileB.originalName}" are identical — no differences detected`
      : `Forensic analysis of "${fileA.originalName}" vs "${fileB.originalName}" identified ${severity} severity differences: ${changeClass}. ${whatChanged.join('; ')}.`;

    const recommendation = severity === 'NONE'    ? 'Files are identical. No action required.'
      : severity === 'LOW'     ? 'Minor differences detected. Review metadata changes and verify they are intentional.'
      : severity === 'MEDIUM'  ? 'Moderate differences found. Compare changed sections carefully before accepting as equivalent.'
      : severity === 'HIGH'    ? 'Significant differences detected. Do not treat these files as equivalent without thorough review.'
      : 'CRITICAL differences detected. Files may indicate tampering, forgery, or unauthorised modification. Escalate for investigation.';

    const evidenceSummary = evidence.length === 0
      ? 'No forensic evidence of differences found.'
      : `${evidence.length} forensic evidence items: ${evidence.slice(0, 3).map(e => e.finding.slice(0, 60)).join('; ')}.`;

    logger.info('Forensic diff complete', {
      diffId, severity, changeClass, processingMs,
    });

    return {
      diffId,
      generatedAt: new Date().toISOString(),
      processingMs,

      fileA: {
        filename:  fileA.originalName,
        fileType:  detA.fileType,
        mimeType:  mimeA,
        sizeBytes: fileA.sizeBytes,
      },
      fileB: {
        filename:  fileB.originalName,
        fileType:  detB.fileType,
        mimeType:  mimeB,
        sizeBytes: fileB.sizeBytes,
      },

      textDiff:     textResult,
      imageDiff:    imageResult,
      metadataDiff: metaResult,

      overallSeverity:      severity,
      overallConfidence:    confidence,
      changeClassification: changeClass,

      evidence: evidence.sort((a, b) => {
        const order: Record<ForensicSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, NONE: 4 };
        return order[a.severity] - order[b.severity];
      }),

      forensicSummary: summary,
      whatChanged,
      whereChanged,
      howChanged,
      recommendation,
      evidenceSummary,
    };
  }
}
