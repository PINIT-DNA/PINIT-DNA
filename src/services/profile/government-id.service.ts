/**
 * Seals one government document to the signed-in Pinit account.
 * A live face check is optional; when given it must match the enrolled template.
 * Every saved proof is also run through the identity-verification pipeline.
 * The document ciphertext is stored apart from the face template.
 * Nothing here decides that the government document is authentic.
 */
import { randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { encryptBytes, decryptTemplate, CURRENT_ENCRYPTION_KEY_VERSION } from '../auth/biometric-crypto.service';
import { acceptProbeForActiveEngine } from '../auth/recognition-engine';
import {
  isFaceProbeQualityOk,
  isValidTemplate,
  normalizeEmbedding,
  verifyClaimedFace,
} from '../auth/biometric-matching.service';
import { verifyPassivePad } from '../auth/passive-pad-engine';
import { padDenyMessage, type PadEvidence } from '../auth/face-liveness.service';
import { isSupabaseStorageConfigured, uploadPrivateObject, deletePrivateObject } from '../../lib/supabase-storage';
import { issueGovernmentIdSeal, readGovernmentIdSeal } from './government-id-seal';
import { extractGovernmentDocumentText } from './government-id-text';
import { isPasswordProtectedPdf, mayListGovernmentIdOnFile, reviewGovernmentDocument, storedDocumentState } from './government-id-document-check';
import { identityVerificationService } from '../identity-verification/identity-verification.service';
import type { DeviceFace, VerificationResult } from '../identity-verification/types';
import {
  effectiveFaceBinding,
  identityTypeForUpload,
  isGovernmentDocumentType,
  sniffGovernmentDocument,
  type DocumentPresence,
  type FaceBindingStatus,
  type GovernmentDocumentType,
} from './government-id-status';

const MAX_BYTES = 8 * 1024 * 1024;

export interface GovernmentIdView {
  documentStatus: DocumentPresence;
  documentType: GovernmentDocumentType | null;
  sealedAt: string | null;
  faceBinding: FaceBindingStatus | null;
  faceBindingCheckedAt: string | null;
  faceEnrolled: boolean;
  /** Always false until a document-verification provider is connected. */
  documentVerified: false;
  /** A back side was stored with the front. */
  hasBackSide: boolean;
}

const FACE_MISMATCH = 'The live face did not match the enrolled face on this Pinit account.';
const NEED_FACE = 'Enroll your face before adding a government ID.';

async function enrolledIdentity(userId: string): Promise<{
  biometricIdentityId: string;
  template: number[];
} | null> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      biometricIdentity: {
        select: {
          id: true,
          faceTemplate: { select: { templateCipher: true, status: true } },
        },
      },
    },
  });
  const identity = row?.biometricIdentity;
  const cipher = identity?.faceTemplate?.status === 'ACTIVE' ? identity.faceTemplate.templateCipher : null;
  if (!identity || !cipher) return null;
  try {
    const template = normalizeEmbedding(decryptTemplate(cipher));
    if (!isValidTemplate(template)) return null;
    return { biometricIdentityId: identity.id, template };
  } catch (err) {
    logger.warn('[GovernmentId] enrolled face could not be read', { userId, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

async function matchLiveFace(userId: string, embedding: number[], padEvidence?: PadEvidence): Promise<
  | { ok: true; biometricIdentityId: string }
  | { ok: false; message: string; binding?: 'NOT_MATCHED' }
> {
  if (!acceptProbeForActiveEngine(embedding) || !isValidTemplate(embedding) || !isFaceProbeQualityOk(embedding)) {
    return { ok: false, message: 'Look at the camera and hold still for a second.' };
  }
  const pad = await verifyPassivePad(padEvidence);
  if (pad.verdict !== 'LIVE') {
    return { ok: false, message: padDenyMessage(pad.verdict, pad.reasons) };
  }
  const enrolled = await enrolledIdentity(userId);
  if (!enrolled) return { ok: false, message: NEED_FACE };
  const verified = verifyClaimedFace({
    claimedUserId: userId,
    probe: normalizeEmbedding(embedding),
    enrolled: enrolled.template,
  });
  if (!verified.ok) {
    logger.info('[GovernmentId] face binding', { userId, result: 'NOT_MATCHED' });
    return { ok: false, message: FACE_MISMATCH, binding: 'NOT_MATCHED' };
  }
  logger.info('[GovernmentId] face binding', { userId, result: 'MATCHED' });
  return { ok: true, biometricIdentityId: enrolled.biometricIdentityId };
}

function viewFromRow(row: {
  documentType: string;
  sealedAt: Date;
  faceBinding: string;
  faceBindingCheckedAt: Date | null;
  documentState: string;
  backStoragePath?: string | null;
} | null, faceEnrolled: boolean, now = Date.now()): GovernmentIdView {
  const empty: GovernmentIdView = {
    documentStatus: 'NOT_ADDED',
    documentType: null,
    sealedAt: null,
    faceBinding: null,
    faceBindingCheckedAt: null,
    faceEnrolled,
    documentVerified: false,
    hasBackSide: false,
  };
  if (!row || !isGovernmentDocumentType(row.documentType) || !mayListGovernmentIdOnFile(row.documentState)) {
    return empty;
  }
  return {
    documentStatus: 'ON_FILE',
    documentType: row.documentType,
    sealedAt: row.sealedAt.toISOString(),
    faceBinding: effectiveFaceBinding({ stored: row.faceBinding, checkedAt: row.faceBindingCheckedAt, now }),
    faceBindingCheckedAt: row.faceBindingCheckedAt?.toISOString() ?? null,
    faceEnrolled,
    documentVerified: false,
    hasBackSide: Boolean(row.backStoragePath),
  };
}

export const governmentIdService = {
  async getForUser(userId: string): Promise<GovernmentIdView> {
    const [row, enrolled] = await Promise.all([
      prisma.governmentIdRecord.findUnique({
        where: { userId },
        select: { documentType: true, sealedAt: true, faceBinding: true, faceBindingCheckedAt: true, documentState: true, backStoragePath: true },
      }),
      enrolledIdentity(userId),
    ]);
    return viewFromRow(row, Boolean(enrolled));
  },

  async onFileForUser(userId: string): Promise<boolean> {
    const row = await prisma.governmentIdRecord.findUnique({ where: { userId }, select: { documentState: true } });
    return mayListGovernmentIdOnFile(row?.documentState);
  },

  async checkFace(userId: string, embedding: number[], padEvidence: PadEvidence | undefined, intent: 'seal' | 'recheck'): Promise<
    | { ok: true; faceBinding: 'MATCHED'; sealToken?: string; checkedAt: string }
    | { ok: false; message: string; faceBinding?: FaceBindingStatus }
  > {
    if (intent === 'recheck') {
      const existing = await prisma.governmentIdRecord.findUnique({ where: { userId }, select: { id: true } });
      if (!existing) return { ok: false, message: 'No government ID is on file for this account.' };
    }
    const matched = await matchLiveFace(userId, embedding, padEvidence);
    const checkedAt = new Date();
    if (!matched.ok) {
      if (intent === 'recheck' && matched.binding === 'NOT_MATCHED') {
        await prisma.governmentIdRecord.update({
          where: { userId },
          data: { faceBinding: 'NOT_MATCHED', faceBindingCheckedAt: checkedAt },
        });
        return { ok: false, message: matched.message, faceBinding: 'NOT_MATCHED' };
      }
      return { ok: false, message: matched.message };
    }
    if (intent === 'recheck') {
      await prisma.governmentIdRecord.update({
        where: { userId },
        data: { faceBinding: 'MATCHED', faceBindingCheckedAt: checkedAt },
      });
      return { ok: true, faceBinding: 'MATCHED', checkedAt: checkedAt.toISOString() };
    }
    return {
      ok: true,
      faceBinding: 'MATCHED',
      sealToken: issueGovernmentIdSeal(userId, matched.biometricIdentityId, checkedAt.getTime()),
      checkedAt: checkedAt.toISOString(),
    };
  },

  async sealDocument(input: {
    userId: string;
    sealToken: string;
    documentType: string;
    mimeType: string;
    bytes: Buffer;
    /** Optional back side (e.g. the Aadhaar address side). Checked and stored like the front. */
    backMimeType?: string;
    backBytes?: Buffer;
    /** Face on the document photograph, found on the device (undefined = not examined). */
    documentFace?: DeviceFace | null;
  }): Promise<{ ok: true; view: GovernmentIdView } | { ok: false; message: string }> {
    // A face seal is optional. When one is sent it must be valid and belong to
    // this account; without one the document is stored without face binding.
    const seal = input.sealToken ? readGovernmentIdSeal(input.sealToken) : null;
    if (input.sealToken && (!seal || seal.userId !== input.userId)) {
      return { ok: false, message: 'That face check expired. Close this and add the ID again.' };
    }
    if (!isGovernmentDocumentType(input.documentType)) {
      return { ok: false, message: 'Choose Aadhaar, PAN card, passport, driving licence, voter ID or another government ID.' };
    }
    if (!input.bytes.length || input.bytes.length > MAX_BYTES) {
      return { ok: false, message: 'Use a file under 8 MB for the front side.' };
    }
    const mime = sniffGovernmentDocument(input.mimeType, input.bytes);
    const frontText = mime ? await extractGovernmentDocumentText(mime, input.bytes) : '';

    // Back side: optional, read and checked like the front. Its text joins the
    // front's, because some fields live only on the back (e.g. Aadhaar address).
    const backBytes = input.backBytes && input.backBytes.length ? input.backBytes : null;
    let backMime: string | null = null;
    let backText = '';
    if (backBytes) {
      if (backBytes.length > MAX_BYTES) {
        return { ok: false, message: 'Use a file under 8 MB for the back side.' };
      }
      backMime = sniffGovernmentDocument(input.backMimeType || '', backBytes);
      if (!backMime) {
        return { ok: false, message: 'The back side must be a JPG, PNG, WEBP or PDF.' };
      }
      if (backMime === 'application/pdf' && isPasswordProtectedPdf(backBytes)) {
        return { ok: false, message: 'The back side is a password-locked PDF. Upload a photo or screenshot instead, or use Scan with camera.' };
      }
      backText = await extractGovernmentDocumentText(backMime, backBytes);
    }
    const extractedText = [frontText, backText].filter(Boolean).join('\n');
    const review = reviewGovernmentDocument({
      claimedType: input.documentType,
      mime,
      bytes: input.bytes,
      extractedText,
      faceBound: Boolean(seal),
    });
    const documentState = storedDocumentState(review);
    if (!mime || !review.ok || !documentState) {
      logger.info('[GovernmentId] document rejected', {
        userId: input.userId,
        documentType: input.documentType,
        reason: review.reason ?? 'rejected',
        reached: review.reached.join(','),
      });
      return { ok: false, message: review.message || 'This file was not accepted as the selected government ID.' };
    }

    // The record links to the account's biometric identity (a required column).
    // With a seal it must be the identity that was face-checked.
    const identity = await prisma.biometricIdentity.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    });
    if (!identity) {
      return { ok: false, message: 'This account has no Pinit identity yet, so an ID proof cannot be linked to it.' };
    }
    if (seal && seal.biometricIdentityId !== identity.id) {
      return { ok: false, message: NEED_FACE };
    }
    const faceBinding = seal ? 'MATCHED' : 'REQUIRES_RECHECK';

    // Full identity checks (checksums, structure, dates, duplicates on other
    // accounts, file signals). A REJECTED run stops the save; anything else is
    // stored with the run so the Pinit team can review it.
    let identityRun: VerificationResult | null = null;
    try {
      identityRun = (await identityVerificationService.verify({
        userId: input.userId,
        documents: [{ bytes: input.bytes, mimeType: mime, declaredType: identityTypeForUpload(input.documentType), extractedText, documentFace: input.documentFace }],
        trigger: 'PROOF_SAVED',
      })).result;
    } catch (err) {
      logger.warn('[GovernmentId] identity checks unavailable', { userId: input.userId, error: err instanceof Error ? err.message : 'unknown' });
    }
    if (identityRun?.status === 'REJECTED') {
      return { ok: false, message: identityRun.reasons[0]?.replace(/^Rejected:\s*/, '') || 'This document could not be accepted.' };
    }
    if (!isSupabaseStorageConfigured()) {
      return { ok: false, message: 'Private document storage is not configured.' };
    }

    const packed = encryptBytes(input.bytes);
    const objectId = randomUUID();
    const storagePath = `government-id/${input.userId}/${objectId}.enc`;
    await uploadPrivateObject(storagePath, packed.cipher);
    let backPacked: { cipher: Buffer; hash: string } | null = null;
    let backStoragePath: string | null = null;
    if (backBytes && backMime) {
      backPacked = encryptBytes(backBytes);
      backStoragePath = `government-id/${input.userId}/${objectId}-back.enc`;
      try {
        await uploadPrivateObject(backStoragePath, backPacked.cipher);
      } catch (err) {
        await deletePrivateObject(storagePath);
        throw err;
      }
    }
    const back = {
      backStoragePath,
      backContentHash: backPacked?.hash ?? null,
      backMimeType: backMime,
      backByteLength: backBytes ? backBytes.length : null,
    };

    const previous = await prisma.governmentIdRecord.findUnique({
      where: { userId: input.userId },
      select: { storagePath: true, backStoragePath: true },
    });
    const now = new Date();
    try {
      await prisma.governmentIdRecord.upsert({
        where: { userId: input.userId },
        create: {
          userId: input.userId,
          biometricIdentityId: identity.id,
          documentType: input.documentType,
          sealedAt: now,
          storagePath,
          contentHash: packed.hash,
          mimeType: mime,
          byteLength: input.bytes.length,
          encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
          faceBinding,
          faceBindingCheckedAt: seal ? now : null,
          documentState,
          ...back,
        },
        update: {
          biometricIdentityId: identity.id,
          documentType: input.documentType,
          sealedAt: now,
          storagePath,
          contentHash: packed.hash,
          mimeType: mime,
          byteLength: input.bytes.length,
          encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
          faceBinding,
          faceBindingCheckedAt: seal ? now : null,
          documentState,
          ...back,
        },
      });
    } catch (err) {
      await deletePrivateObject(storagePath);
      if (backStoragePath) await deletePrivateObject(backStoragePath);
      logger.warn('[GovernmentId] seal write failed', { userId: input.userId, error: err instanceof Error ? err.message : 'unknown' });
      return { ok: false, message: 'The government ID could not be saved. Try again.' };
    }

    if (previous && previous.storagePath !== storagePath) {
      await deletePrivateObject(previous.storagePath);
    }
    if (previous?.backStoragePath && previous.backStoragePath !== backStoragePath) {
      await deletePrivateObject(previous.backStoragePath);
    }
    if (identityRun) await identityVerificationService.registerFingerprints(input.userId, identityRun);
    logger.info('[GovernmentId] document sealed', { userId: input.userId, documentType: input.documentType, backSide: Boolean(backStoragePath) });
    const view = await this.getForUser(input.userId);
    return { ok: true, view };
  },
};
