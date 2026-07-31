/**
 * Lightweight DNA API — for Internet Intelligence Engine integration.
 */
import { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import { isPhase2Active, dnaPhase2 } from '../../config/dna-phase2';
import { AppError } from '../middleware/error.middleware';
import {
  generateLightweightDna,
  compareLightweightDna,
  extractImageFingerprint,
  extractVideoFingerprint,
  extractAudioFingerprint,
} from '../../services/forensics/lightweight-dna.service';
import type { LightweightDnaFingerprint } from '../../types/dna-enhancements.types';

function assertLightweightApiEnabled(): void {
  if (!isPhase2Active() || !dnaPhase2.lightweightApi) {
    throw new AppError(503, 'Lightweight DNA API is disabled. Set DNA_ENHANCEMENTS_ENABLED=true and DNA_PHASE2_ENABLED=true');
  }
}

function getBuffer(req: Request): Buffer {
  const file = req.file;
  if (!file?.buffer && !file?.path) {
    throw new AppError(400, 'No file uploaded');
  }
  return file.buffer ?? fs.readFileSync(file.path);
}

export async function generateLightweightDnaHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertLightweightApiEnabled();
    const buffer = getBuffer(req);
    const mimeType = req.file?.mimetype ?? 'application/octet-stream';
    const fileType = (req.body?.fileType as string) || undefined;
    const fingerprint = await generateLightweightDna(buffer, mimeType, fileType);
    res.json({ success: true, fingerprint });
  } catch (err) {
    next(err);
  }
}

export async function compareLightweightDnaHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertLightweightApiEnabled();
    const body = req.body as { fingerprintA?: LightweightDnaFingerprint; fingerprintB?: LightweightDnaFingerprint };
    if (!body.fingerprintA || !body.fingerprintB) {
      throw new AppError(400, 'fingerprintA and fingerprintB JSON fields required');
    }
    const result = compareLightweightDna(body.fingerprintA, body.fingerprintB);
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function extractImageFingerprintHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertLightweightApiEnabled();
    const buffer = getBuffer(req);
    const mimeType = req.file?.mimetype ?? 'image/jpeg';
    const fingerprint = await extractImageFingerprint(buffer, mimeType);
    res.json({ success: true, fingerprint });
  } catch (err) {
    next(err);
  }
}

export async function extractVideoFingerprintHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertLightweightApiEnabled();
    const buffer = getBuffer(req);
    const fingerprint = await extractVideoFingerprint(buffer);
    res.json({ success: true, fingerprint });
  } catch (err) {
    next(err);
  }
}

export async function extractAudioFingerprintHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    assertLightweightApiEnabled();
    const buffer = getBuffer(req);
    const fingerprint = await extractAudioFingerprint(buffer, req.file?.path);
    res.json({ success: true, fingerprint });
  } catch (err) {
    next(err);
  }
}
