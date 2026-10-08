/**
 * Seals one government document to the signed-in Pinit account.
 * A live face check is optional; when given it must match the enrolled template.
 * Every saved proof is also run through the identity-verification pipeline.
 * The document ciphertext is stored apart from the face template.
 * Nothing here decides that the government document is authentic.
 */
import { createHash, randomUUID } from 'crypto';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { encryptBytes, decryptBytes, decryptTemplate, CURRENT_ENCRYPTION_KEY_VERSION } from '../auth/biometric-crypto.service';
import { viewVerifiedDetails, type VerifiedDetailsView, type VerifiedIdentityData } from '../identity-verification/verified-details';
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

  /**
   * The details read from this account's verified ID, for the owner only.
   * Sensitive values are masked unless the owner asks to reveal them. Returns
   * null when no verified ID is kept.
   */
  async verifiedDetailsForUser(userId: string, reveal: boolean): Promise<VerifiedDetailsView | null> {
    const row = await prisma.governmentIdRecord.findUnique({ where: { userId }, select: { identityDataCipher: true } });
    if (!row?.identityDataCipher) return null;
    try {
      const data = JSON.parse(decryptBytes(Buffer.from(row.identityDataCipher)).toString('utf8')) as VerifiedIdentityData;
      logger.info('[GovernmentId] verified details viewed', { userId, revealed: reveal });
      return viewVerifiedDetails(data, reveal);
    } catch (err) {
      logger.warn('[GovernmentId] verified details unreadable', { userId, error: err instanceof Error ? err.message : 'unknown' });
      return null;
    }
  },

  /**
   * The owner corrects the address that was read from their ID. The stored
   * details are decrypted, the address replaced and encrypted again; nothing
   * else changes. Returns false when no verified details are kept.
   */
  async updateVerifiedAddress(userId: string, address: string): Promise<boolean> {
    const row = await prisma.governmentIdRecord.findUnique({ where: { userId }, select: { identityDataCipher: true } });
    if (!row?.identityDataCipher) return false;
    const data = JSON.parse(decryptBytes(Buffer.from(row.identityDataCipher)).toString('utf8')) as VerifiedIdentityData;
    data.address = address;
    data.addressEditedByOwner = true;
    const packed = encryptBytes(Buffer.from(JSON.stringify(data), 'utf8'));
    await prisma.governmentIdRecord.update({ where: { userId }, data: { identityDataCipher: packed.cipher } });
    logger.info('[GovernmentId] verified address corrected by the owner', { userId });
    return true;
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
    const frontRead: { text: string; confidence: number; unclear?: boolean } = mime ? await extractGovernmentDocumentText(mime, input.bytes) : { text: '', confidence: 0 };
    if (frontRead.unclear) return { ok: false, message: 'Document image is unclear. Please capture the ID again.' };
    const frontText = frontRead.text;

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
      const backRead = await extractGovernmentDocumentText(backMime, backBytes);
      if (backRead.unclear) return { ok: false, message: 'Document image is unclear. Please capture the ID again.' };
      backText = backRead.text;
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

    const fileHash = createHash('sha256').update(input.bytes).digest('hex');
    const sameImage = await prisma.governmentIdRecord.findFirst({
      where: { contentHash: fileHash, userId: { not: input.userId } },
      select: { id: true },
    });
    if (sameImage) {
      return { ok: false, message: 'This identity document image is already associated with another PINIT account.' };
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
          contentHash: fileHash,
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
          contentHash: fileHash,
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

  /** Removes the signed-in user's saved ID and the details read from it. */
  async clearForUser(userId: string): Promise<GovernmentIdView> {
    const row = await prisma.governmentIdRecord.findUnique({
      where: { userId },
      select: { storagePath: true, backStoragePath: true },
    });
    if (row?.storagePath) await deletePrivateObject(row.storagePath).catch(() => undefined);
    if (row?.backStoragePath) await deletePrivateObject(row.backStoragePath).catch(() => undefined);
    await prisma.$transaction([
      prisma.governmentIdRecord.deleteMany({ where: { userId } }),
      prisma.identityDocumentFingerprint.deleteMany({ where: { userId } }),
      prisma.identityVerificationRun.deleteMany({ where: { userId } }),
    ]);
    logger.info('[GovernmentId] proof cleared', { userId });
    return this.getForUser(userId);
  },
};
