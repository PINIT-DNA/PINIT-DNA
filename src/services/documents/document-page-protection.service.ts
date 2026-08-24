/**
 * Document Page Protection — Phase 1 (PDF)
 *
 * Rasterizes each page of a document into an image and runs it through the
 * exact same pixel-level protection pipeline a standalone image upload gets:
 *   1. DnaOrchestrator.generate()      — full image DNA (15 layers)
 *   2. tryEnrollSpatialAuthAfterDna()  — pixel HKCA tamper localization
 *   3. localDnaIndexService.buildIndex() — patch-level local DNA (crop/fragment recovery)
 *
 * Each page becomes its own child DnaRecord, linked back to the parent
 * document DnaRecord via documentDnaRecordId/pageNumber. This is additive and
 * best-effort — failures never affect the parent document's DNA record.
 */
import { PDFDocument } from 'pdf-lib';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { DnaOrchestrator } from '../dna.orchestrator';
import { aiService } from '../ai/ai-embeddings.service';
import { tryEnrollSpatialAuthAfterDna } from '../spatial/enroll.service';
import { localDnaIndexService } from '../forensics/local-dna-index.service';
import { identityEmbeddingService } from '../identity/identity-embedding.service';
import { DnaComparisonService } from '../verification/dna-comparison.service';
import {
  documentPixelProtectionConfig,
  isDocumentPixelProtectionEnabled,
} from '../../config/document-pixel-protection';
import { DNA_GENERATOR_VERSION } from '../../config/dna-versions';
import type { ImageInput } from '../../types/dna.types';
import type { FileInput } from '../universal-file-router';

export interface DocumentPageProtectionResult {
  totalPages: number;
  pagesRendered: number;
  pagesProtected: number;
  pagesFailed: number;
  truncated: boolean;
}

export interface ProtectedDocumentAssembly {
  pdfBuffer: Buffer;
  pageCount: number;
}

export interface DocumentPageVerification {
  pageNumber: number;
  vaultPageDnaRecordId: string | null;
  /** L1 — exact byte-for-byte match of the rendered page */
  cryptographicMatch: boolean;
  /** L3 — perceptual hash similarity (0-100), robust to re-encoding */
  perceptualSimilarityPercent: number | null;
  /** Raw engine classification/score — kept for transparency, NOT used to decide `changed`
   * (the engine's DNA_MATCH/tamperingDetected also factor in the per-record embedded
   * identity signature, which never matches a bare re-rasterized probe by design). */
  classification: string | null;
  overallConfidenceScore: number;
  /** True content-change verdict, based only on L1/L3 (pixel content), not identity/signature layers */
  changed: boolean;
}

export interface DocumentVerifyResult {
  documentDnaRecordId: string;
  originalPageCount: number;
  probePageCount: number;
  pageCountChanged: boolean;
  pagesChanged: number;
  pagesMatched: number;
  pages: DocumentPageVerification[];
  overallTampered: boolean;
}

export class DocumentPageProtectionService {
  private readonly imageEngine = new DnaOrchestrator();
  private readonly comparison = new DnaComparisonService();

  async protectPdfPages(params: {
    documentDnaRecordId: string;
    buffer: Buffer;
    originalName: string;
    ownerUserId?: string;
  }): Promise<DocumentPageProtectionResult | null> {
    if (!isDocumentPixelProtectionEnabled()) return null;
    if (!params.ownerUserId) {
      logger.debug('[DocumentPageProtection] Skipped — no ownerUserId', {
        documentDnaRecordId: params.documentDnaRecordId,
      });
      return null;
    }

    const raster = await aiService.rasterizeDocument(params.buffer, params.originalName, {
      dpi: documentPixelProtectionConfig.dpi,
      maxPages: documentPixelProtectionConfig.maxPages,
    });

    if (!raster || !raster.pages.length) {
      logger.warn('[DocumentPageProtection] Rasterization unavailable — pixel protection skipped', {
        documentDnaRecordId: params.documentDnaRecordId,
      });
      return null;
    }

    let pagesProtected = 0;
    let pagesFailed = 0;

    for (const page of raster.pages) {
      try {
        await this.protectOnePage({
          documentDnaRecordId: params.documentDnaRecordId,
          ownerUserId: params.ownerUserId,
          pageNumber: page.pageNumber,
          pngBuffer: Buffer.from(page.imageBase64, 'base64'),
        });
        pagesProtected++;
      } catch (err) {
        pagesFailed++;
        logger.warn('[DocumentPageProtection] Page protection failed (non-fatal)', {
          documentDnaRecordId: params.documentDnaRecordId,
          pageNumber: page.pageNumber,
          error: String(err),
        });
      }
    }

    logger.info('[DocumentPageProtection] Complete', {
      documentDnaRecordId: params.documentDnaRecordId,
      totalPages: raster.totalPages,
      pagesRendered: raster.renderedPages,
      pagesProtected,
      pagesFailed,
      truncated: raster.truncated,
    });

    return {
      totalPages: raster.totalPages,
      pagesRendered: raster.renderedPages,
      pagesProtected,
      pagesFailed,
      truncated: raster.truncated,
    };
  }

  private async protectOnePage(params: {
    documentDnaRecordId: string;
    ownerUserId: string;
    pageNumber: number;
    pngBuffer: Buffer;
  }): Promise<void> {
    // Idempotent: protectPdfPages can be re-triggered for the same document
    // (the DNA-generate-time fire-and-forget hook, a retry, or a concurrent
    // vault-store call) — reuse the existing page record instead of creating
    // a duplicate DnaRecord every time.
    const existing = await prisma.dnaRecord.findFirst({
      where: { documentDnaRecordId: params.documentDnaRecordId, pageNumber: params.pageNumber },
      select: { id: true },
    });
    if (existing) {
      logger.debug('[DocumentPageProtection] Page already protected — reusing', {
        documentDnaRecordId: params.documentDnaRecordId,
        pageNumber: params.pageNumber,
        pageDnaRecordId: existing.id,
      });
      return;
    }

    const pageImage: ImageInput = {
      filePath: `<document-page>/${params.documentDnaRecordId}/page-${params.pageNumber}.png`,
      originalName: `page-${params.pageNumber}.png`,
      mimeType: 'image/png',
      sizeBytes: params.pngBuffer.length,
      buffer: params.pngBuffer,
    };

    // Note: DnaOrchestrator.generate() already runs pixel HKCA enrollment
    // internally on these raw bytes (see dna.orchestrator.ts) — skipSpatialPixel1
    // trims that to just the cheap HKCA (3A) pass, skipping the expensive dense
    // per-pixel (4E) pass, which multiplies badly across a multi-page document.
    const result = await this.imageEngine.generate(pageImage, {
      fileType: 'IMAGE',
      engineVersion: DNA_GENERATOR_VERSION,
      ownerUserId: params.ownerUserId,
      skipSpatialPixel1: true,
    });

    const pageDnaRecordId = result.dnaRecordId;

    await prisma.dnaRecord.update({
      where: { id: pageDnaRecordId },
      data: {
        documentDnaRecordId: params.documentDnaRecordId,
        pageNumber: params.pageNumber,
      },
    });

    await localDnaIndexService.buildIndex({
      buffer: params.pngBuffer,
      mimeType: 'image/png',
      dnaRecordId: pageDnaRecordId,
      vaultId: pageDnaRecordId,
      ownerUserId: params.ownerUserId,
    }).catch((err) => {
      logger.warn('[DocumentPageProtection] Local DNA patch index failed (non-fatal)', {
        pageDnaRecordId,
        error: String(err),
      });
    });
  }

  // ─── Vault-time: embed identity into every page + reassemble a downloadable
  // protected PDF (mirrors how a standalone image gets identity-embedded at
  // vault-store time, before encryption). ────────────────────────────────────

  /**
   * Builds a "protected" PDF where every page carries an invisible, verifiable
   * DNA signature embedded directly in its pixels (same mechanism a standalone
   * protected image gets). Called from VaultService.store() for PDF uploads —
   * the returned buffer is what gets encrypted and stored, so the existing
   * vault download flow serves the pixel-protected pages with zero new
   * download code.
   */
  async protectAndAssembleForVault(params: {
    documentDnaRecordId: string;
    buffer: Buffer;
    originalName: string;
    ownerUserId: string;
  }): Promise<ProtectedDocumentAssembly | null> {
    if (!isDocumentPixelProtectionEnabled()) return null;

    const raster = await aiService.rasterizeDocument(params.buffer, params.originalName, {
      dpi: documentPixelProtectionConfig.dpi,
      maxPages: documentPixelProtectionConfig.maxPages,
    });
    if (!raster || !raster.pages.length) {
      logger.warn('[DocumentPageProtection] Rasterization unavailable — vault stores raw PDF', {
        documentDnaRecordId: params.documentDnaRecordId,
      });
      return null;
    }

    const embeddedPages: Array<{ pageNumber: number; width: number; height: number; buffer: Buffer }> = [];

    for (const page of raster.pages) {
      try {
        const buffer = await this.protectOnePageForVault({
          documentDnaRecordId: params.documentDnaRecordId,
          ownerUserId: params.ownerUserId,
          pageNumber: page.pageNumber,
          rawPngBuffer: Buffer.from(page.imageBase64, 'base64'),
        });
        embeddedPages.push({ pageNumber: page.pageNumber, width: page.width, height: page.height, buffer });
      } catch (err) {
        logger.warn('[DocumentPageProtection] Vault-time page embed failed (non-fatal)', {
          documentDnaRecordId: params.documentDnaRecordId,
          pageNumber: page.pageNumber,
          error: String(err),
        });
      }
    }

    if (!embeddedPages.length) return null;

    const dpi = raster.dpi || documentPixelProtectionConfig.dpi;
    const pdfDoc = await PDFDocument.create();
    for (const page of embeddedPages.sort((a, b) => a.pageNumber - b.pageNumber)) {
      const img = await pdfDoc.embedPng(page.buffer);
      const widthPt = (page.width * 72) / dpi;
      const heightPt = (page.height * 72) / dpi;
      const pdfPage = pdfDoc.addPage([widthPt, heightPt]);
      pdfPage.drawImage(img, { x: 0, y: 0, width: widthPt, height: heightPt });
    }
    const pdfBytes = await pdfDoc.save();

    logger.info('[DocumentPageProtection] Protected PDF assembled', {
      documentDnaRecordId: params.documentDnaRecordId,
      pageCount: embeddedPages.length,
    });

    return { pdfBuffer: Buffer.from(pdfBytes), pageCount: embeddedPages.length };
  }

  private async protectOnePageForVault(params: {
    documentDnaRecordId: string;
    ownerUserId: string;
    pageNumber: number;
    rawPngBuffer: Buffer;
  }): Promise<Buffer> {
    // Reuse the page's DnaRecord if the fire-and-forget DNA-generate-time
    // protection already created it; otherwise create it now via the same path.
    let pageDnaRecordId: string;
    const existing = await prisma.dnaRecord.findFirst({
      where: { documentDnaRecordId: params.documentDnaRecordId, pageNumber: params.pageNumber },
      select: { id: true },
    });

    if (existing) {
      pageDnaRecordId = existing.id;
    } else {
      await this.protectOnePage({
        documentDnaRecordId: params.documentDnaRecordId,
        ownerUserId: params.ownerUserId,
        pageNumber: params.pageNumber,
        pngBuffer: params.rawPngBuffer,
      });
      const created = await prisma.dnaRecord.findFirst({
        where: { documentDnaRecordId: params.documentDnaRecordId, pageNumber: params.pageNumber },
        select: { id: true },
      });
      if (!created) throw new Error(`Page DnaRecord creation failed for page ${params.pageNumber}`);
      pageDnaRecordId = created.id;
    }

    // Embed a verifiable DNA signature directly into this page's pixels —
    // dnaId identifies the page, vaultId links it back to the parent document.
    const embedResult = await identityEmbeddingService.embed(
      params.rawPngBuffer,
      'image/png',
      `page-${params.pageNumber}.png`,
      { dnaId: pageDnaRecordId, vaultId: params.documentDnaRecordId, ownerUserId: params.ownerUserId },
    );
    const embeddedBuffer = embedResult.success ? embedResult.buffer : params.rawPngBuffer;

    // Re-enroll pixel HKCA + rebuild the local-DNA patch index on the POST-embed
    // bytes (embedding changes pixels, so tamper localization must key off the
    // bytes that actually leave the vault — same ordering VaultService uses
    // for standalone images).
    await tryEnrollSpatialAuthAfterDna({
      imageBuffer: embeddedBuffer,
      dnaRecordId: pageDnaRecordId,
      ownerUserId: params.ownerUserId,
      skipPixel1: true,
    }).catch((err) => {
      logger.warn('[DocumentPageProtection] Vault-time HKCA re-enroll failed (non-fatal)', {
        pageDnaRecordId,
        error: String(err),
      });
    });

    await localDnaIndexService.buildIndex({
      buffer: embeddedBuffer,
      mimeType: 'image/png',
      dnaRecordId: pageDnaRecordId,
      vaultId: pageDnaRecordId,
      ownerUserId: params.ownerUserId,
    }).catch((err) => {
      logger.warn('[DocumentPageProtection] Vault-time local-DNA rebuild failed (non-fatal)', {
        pageDnaRecordId,
        error: String(err),
      });
    });

    return embeddedBuffer;
  }

  // ─── Tamper detection: compare a suspect document against a protected one ──

  /**
   * Rasterizes a probe (suspect) document and compares each page against the
   * corresponding protected page's stored DNA, reusing the same layer-by-layer
   * comparison + tamper detection standalone images get. Reports exactly which
   * page(s) changed.
   */
  async verifyProtectedDocument(params: {
    documentDnaRecordId: string;
    probeBuffer: Buffer;
    probeFileName: string;
    ownerUserId: string;
  }): Promise<DocumentVerifyResult | null> {
    const originalPages = await prisma.dnaRecord.findMany({
      where: { documentDnaRecordId: params.documentDnaRecordId },
      orderBy: { pageNumber: 'asc' },
      select: { id: true, pageNumber: true },
    });
    if (!originalPages.length) return null;

    const raster = await aiService.rasterizeDocument(params.probeBuffer, params.probeFileName, {
      dpi: documentPixelProtectionConfig.dpi,
      maxPages: documentPixelProtectionConfig.maxPages,
    });
    if (!raster || !raster.pages.length) return null;

    const probeByPageNumber = new Map(raster.pages.map((p) => [p.pageNumber, p]));
    const pages: DocumentPageVerification[] = [];
    let pagesChanged = 0;
    let pagesMatched = 0;

    for (const orig of originalPages) {
      if (orig.pageNumber == null) continue;
      const probePage = probeByPageNumber.get(orig.pageNumber);

      if (!probePage) {
        pages.push({
          pageNumber: orig.pageNumber,
          vaultPageDnaRecordId: orig.id,
          cryptographicMatch: false,
          perceptualSimilarityPercent: null,
          classification: null,
          overallConfidenceScore: 0,
          changed: true,
        });
        pagesChanged++;
        continue;
      }

      const probeBuffer = Buffer.from(probePage.imageBase64, 'base64');
      const placeholder: FileInput = {
        filePath: '',
        originalName: `page-${orig.pageNumber}.png`,
        declaredMimeType: 'image/png',
        sizeBytes: 0,
        buffer: Buffer.alloc(0),
      };
      const probeFile: FileInput = {
        filePath: '',
        originalName: `page-${orig.pageNumber}.png`,
        declaredMimeType: 'image/png',
        sizeBytes: probeBuffer.length,
        buffer: probeBuffer,
      };

      try {
        const result = await this.comparison.compare(placeholder, probeFile, {
          vaultDnaRecordId: orig.id,
          preferLiveVaultFingerprint: false,
        });

        // Decide "changed" from CONTENT layers only (L1 cryptographic exact
        // match, L3 perceptual similarity). Do NOT use the engine's overall
        // classification/tamperingDetected here — those also weigh L5
        // (metadata) and L6 (the embedded per-record identity signature),
        // which structurally can never match a freshly-rasterized probe that
        // was never embedded, regardless of whether the page content actually
        // changed. Threshold (0.92) matches the engine's own "re-encoded but
        // perceptually identical" bar.
        const l1 = result.layerComparisons.find((l) => l.layer === 1);
        const l3 = result.layerComparisons.find((l) => l.layer === 3);
        const cryptographicMatch = l1?.matched === true;
        const perceptualSimilarityPercent = l3?.similarityPercent ?? null;
        const changed = !cryptographicMatch && (l3 == null || l3.similarityScore < 0.92);

        if (changed) pagesChanged++; else pagesMatched++;
        pages.push({
          pageNumber: orig.pageNumber,
          vaultPageDnaRecordId: orig.id,
          cryptographicMatch,
          perceptualSimilarityPercent,
          classification: result.classification,
          overallConfidenceScore: result.overallConfidenceScore,
          changed,
        });
      } catch (err) {
        logger.warn('[DocumentPageProtection] Page compare failed (non-fatal)', {
          documentDnaRecordId: params.documentDnaRecordId,
          pageNumber: orig.pageNumber,
          error: String(err),
        });
        pages.push({
          pageNumber: orig.pageNumber,
          vaultPageDnaRecordId: orig.id,
          cryptographicMatch: false,
          perceptualSimilarityPercent: null,
          classification: null,
          overallConfidenceScore: 0,
          changed: true,
        });
        pagesChanged++;
      }
    }

    const pageCountChanged = originalPages.length !== raster.pages.length;

    return {
      documentDnaRecordId: params.documentDnaRecordId,
      originalPageCount: originalPages.length,
      probePageCount: raster.pages.length,
      pageCountChanged,
      pagesChanged,
      pagesMatched,
      pages,
      overallTampered: pagesChanged > 0 || pageCountChanged,
    };
  }
}

export const documentPageProtectionService = new DocumentPageProtectionService();
