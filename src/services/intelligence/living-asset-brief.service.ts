/**
 * Two-line living-asset description (image scene or document topic).
 * Generated once, stored on VaultRecord.contentAnalysis.livingBrief.
 */
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { VaultService } from '../vault/vault.service';
import { aiService } from '../ai/ai-embeddings.service';
import { describeFromDocumentText, describeFromImage } from './ask-pinit-llm';
import { twoLines } from './living-asset-brief-text';

const vaultService = new VaultService();

export type LivingBrief = {
  line1: string;
  line2: string;
  spoken: string;
  source: 'vision' | 'clip' | 'document' | 'fallback';
};

function asObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? { ...(raw as Record<string, unknown>) } : {};
}

function looksLikeFallback(line1?: string, line2?: string, source?: string): boolean {
  if (source === 'fallback') return true;
  const blob = `${line1 || ''} ${line2 || ''}`;
  return /named .+\.|description is not recorded yet|could not be generated yet|protected photograph named|protected file named/i.test(blob);
}

function isSensitiveIdDoc(text: string, name: string): boolean {
  return /\b(passport|aadhaar|aadhar|pan card|driver'?s? licen[cs]e|visa|national id|ssn)\b/i.test(`${text} ${name}`);
}

function redactIds(text: string): string {
  return text
    .replace(/\b[A-Z0-9]{6,}\b/g, '[id]')
    .replace(/\b\d{4,}\b/g, '[number]')
    .replace(/[A-Z0-9<]{20,}/g, '[code]');
}

export async function getOrCreateLivingBrief(ownerUserId: string, vaultId: string): Promise<LivingBrief> {
  const vault = await prisma.vaultRecord.findFirst({
    where: { id: vaultId, dnaRecord: { ownerUserId } },
    select: {
      id: true,
      originalFileName: true,
      originalMimeType: true,
      contentAnalysis: true,
      dnaRecordId: true,
    },
  });
  if (!vault) {
    return {
      line1: 'I am a protected asset in PinIT Vault.',
      line2: 'Open this page as the owner to hear my stored description.',
      spoken: 'I am a protected asset in PinIT Vault. Open this page as the owner to hear my stored description.',
      source: 'fallback',
    };
  }

  const existing = asObject(vault.contentAnalysis).livingBrief;
  if (existing && typeof existing === 'object') {
    const row = existing as { line1?: string; line2?: string; source?: LivingBrief['source'] };
    const stale = looksLikeFallback(row.line1, row.line2, row.source);
    if (row.line1 && row.line2 && !stale) {
      return {
        line1: row.line1,
        line2: row.line2,
        spoken: `${row.line1} ${row.line2}`,
        source: row.source || 'fallback',
      };
    }
  }

  const mime = (vault.originalMimeType || '').toLowerCase();
  const name = vault.originalFileName || 'this file';
  const isImage =
    (mime.startsWith('image/') && !mime.includes('svg'))
    || /\.(jpe?g|png|webp|gif|heic|bmp)$/i.test(name);
  const isDoc =
    mime.includes('pdf') || mime.includes('word') || mime.includes('text')
    || /\.(pdf|docx?|txt)$/i.test(name);

  const fallback1 = isImage
    ? `I am a photograph named ${name}.`
    : isDoc
      ? `I am a document named ${name}.`
      : `I am a file named ${name}.`;
  const fallback2 = 'A visual description could not be generated yet.';

  let source: LivingBrief['source'] = 'fallback';
  let generated = '';

  if (isImage) {
    try {
      const file = await vaultService.retrieve(vaultId, ownerUserId);
      const jpeg = await sharp(file.originalBuffer)
        .rotate()
        .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 72 })
        .toBuffer();

      const vision = await describeFromImage(jpeg.toString('base64'));
      if (vision) {
        generated = vision;
        source = 'vision';
      }

      if (!generated) {
        const clip = await aiService.describeScene(jpeg, 'image/jpeg', name);
        if (clip?.line1) {
          generated = `${clip.line1} ${clip.line2}`;
          source = 'clip';
        }
      }
    } catch (err) {
      logger.warn('[living-brief] image describe failed', {
        vaultId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!generated && (isDoc || isImage)) {
    const ocr = await prisma.ocrRecord.findUnique({
      where: { dnaRecordId: vault.dnaRecordId },
      select: { extractedText: true },
    });
    const excerpt = redactIds((ocr?.extractedText || '').trim());
    if (isSensitiveIdDoc(excerpt, name)) {
      generated = 'I am an identity or official document such as a passport or ID. Personal numbers are not spoken here.';
      source = 'document';
    } else if (excerpt.length > 40) {
      const summary = await describeFromDocumentText(excerpt);
      generated = summary || excerpt.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
      source = 'document';
    }
  }

  const [line1, line2] = twoLines(generated, fallback1, fallback2);
  const brief: LivingBrief = { line1, line2, spoken: `${line1} ${line2}`, source };

  const nextAnalysis = {
    ...asObject(vault.contentAnalysis),
    livingBrief: {
      line1,
      line2,
      source,
      at: new Date().toISOString(),
    },
  };
  await prisma.vaultRecord.update({
    where: { id: vaultId },
    data: { contentAnalysis: nextAnalysis as Prisma.InputJsonValue },
  });

  return brief;
}
