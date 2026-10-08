/**
 * Runs the identity verification pipeline against real inputs and keeps an
 * audit trail. Everything that touches the outside world lives here; the
 * pipeline itself (pipeline.ts) stays pure.
 *
 * Privacy:
 * - Files are read in memory only. This service never stores document images.
 * - Extracted fields are stored only inside the encrypted run result.
 * - Document numbers are stored only as keyed fingerprints (HMAC).
 * - Logs carry decisions and codes, never names, numbers or OCR text.
 * - Persistence failures never block the person; they are logged.
 */
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import {
  CURRENT_ENCRYPTION_KEY_VERSION, decryptBytes, decryptTemplate, encryptBytes, keyedFingerprint,
} from '../auth/biometric-crypto.service';
import { verifyPassivePad } from '../auth/passive-pad-engine';
import type { PadEvidence } from '../auth/face-liveness.service';
import { extractGovernmentDocumentText } from '../profile/government-id-text';
import { sniffGovernmentDocument } from '../profile/government-id-status';
import { collectFileSignals } from './authenticity';
import { runIdentityVerification } from './pipeline';
import { buildVerifiedIdentityData } from './verified-details';
import type {
  DeviceFace, DocumentInput, DocumentReport, ExtractedFields, IdentityDocumentType, LiveCapture, VerificationResult,
} from './types';
import { IDENTITY_DOCUMENT_TYPES } from './types';

export interface UploadedDocument {
  bytes: Buffer;
  mimeType: string;
  declaredType?: IdentityDocumentType | null;
  documentFace?: DeviceFace | null;
  /** Text already read by the caller (avoids running OCR twice). */
  extractedText?: string;
  /** Optional back side of the same document; its text joins the front's. */
  backBytes?: Buffer;
  backMimeType?: string;
}

export type RunTrigger = 'ANALYZE' | 'PROOF_SAVED';

export function isIdentityDocumentType(v: unknown): v is IdentityDocumentType {
  return typeof v === 'string' && (IDENTITY_DOCUMENT_TYPES as readonly string[]).includes(v);
}

export async function prepareDocument(d: UploadedDocument): Promise<DocumentInput> {
  const mime = sniffGovernmentDocument(d.mimeType, d.bytes);
  const fileSignals = await collectFileSignals(mime, d.bytes);
  if (!mime) fileSignals.intact = false;
  let frontText = '';
  let frontConfidence: number | undefined;
  let ocrTokens: DocumentInput['ocrTokens'];
  if (d.extractedText !== undefined) {
    frontText = d.extractedText;
  } else if (mime && !fileSignals.locked) {
    const read = await extractGovernmentDocumentText(mime, d.bytes);
    frontText = read.text;
    frontConfidence = read.confidence;
    ocrTokens = read.tokens;
  }
  if (frontConfidence !== undefined) fileSignals.ocrConfidence = frontConfidence;
  let backText = '';
  if (d.backBytes?.length && d.extractedText === undefined) {
    const backMime = sniffGovernmentDocument(d.backMimeType || '', d.backBytes);
    const backSignals = backMime ? await collectFileSignals(backMime, d.backBytes) : { locked: false };
    if (backMime && !backSignals.locked) {
      const backRead = await extractGovernmentDocumentText(backMime, d.backBytes);
      backText = backRead.text;
      const shifted = backRead.tokens.map((t) => ({ ...t, y0: t.y0 + 8000, y1: t.y1 + 8000 }));
      ocrTokens = [...(ocrTokens ?? []), ...shifted];
    }
  }
  const extractedText = [frontText, backText].filter(Boolean).join('\n');
  return {
    declaredType: d.declaredType ?? null,
    mimeType: mime,
    bytes: d.bytes,
    extractedText,
    ocrTokens,
    fileSignals,
    documentFace: d.documentFace,
  };
}

/** Keyed fingerprint of a full document number. Masked numbers have none. */
export function documentFingerprint(type: IdentityDocumentType, fields: ExtractedFields): string | null {
  const raw = fields.documentNumber?.value;
  if (!raw || /^X{4}/i.test(raw)) return null;
  const normalized = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (normalized.length < 6) return null;
  return keyedFingerprint('identity-document', `${type}:${normalized}`);
}

async function fingerprintsOnOtherAccounts(userId: string, fingerprints: Array<string | null>): Promise<Set<string>> {
  const wanted = fingerprints.filter((f): f is string => Boolean(f));
  if (!wanted.length) return new Set();
  try {
    const rows = await prisma.identityDocumentFingerprint.findMany({
      where: { fingerprint: { in: wanted }, NOT: { userId } },
      select: { fingerprint: true },
    });
    return new Set(rows.map((r) => r.fingerprint));
  } catch (err) {
    logger.warn('[IdentityVerification] duplicate lookup unavailable', { error: err instanceof Error ? err.message : 'unknown' });
    return new Set();
  }
}

async function enrolledTemplate(userId: string): Promise<number[] | null> {
  try {
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: { biometricIdentity: { select: { faceTemplate: { select: { templateCipher: true, status: true } } } } },
    });
    const t = row?.biometricIdentity?.faceTemplate;
    return t?.status === 'ACTIVE' && t.templateCipher ? decryptTemplate(t.templateCipher) : null;
  } catch {
    return null;
  }
}

type PadVerdict = { verdict: 'LIVE' | 'SPOOF' | 'UNKNOWN'; reasons: string[] };

/** UNKNOWN and ERROR are not LIVE: the pipeline treats them as a failed liveness check. */
async function padFor(live: LiveCapture | null | undefined): Promise<PadVerdict | null> {
  if (!live) return null;
  try {
    const pad = await verifyPassivePad(live.padEvidence as PadEvidence | undefined);
    const verdict = pad.verdict === 'LIVE' ? 'LIVE' : pad.verdict === 'SPOOF' ? 'SPOOF' : 'UNKNOWN';
    return { verdict, reasons: Array.isArray(pad.reasons) ? pad.reasons.map(String) : [] };
  } catch {
    return { verdict: 'UNKNOWN', reasons: ['pad_unavailable'] };
  }
}

/** The saved ID proof's document report from its most recent PROOF_SAVED run (decrypted). */
async function savedProofReports(userId: string): Promise<DocumentReport[]> {
  try {
    const row = await prisma.identityVerificationRun.findFirst({
      where: { userId, trigger: 'PROOF_SAVED' },
      orderBy: { createdAt: 'desc' },
      select: { resultCipher: true },
    });
    if (!row) return [];
    const result = JSON.parse(decryptBytes(Buffer.from(row.resultCipher)).toString('utf8')) as VerificationResult;
    return (result.documents ?? []).filter((d) => d.origin !== 'SAVED_PROOF');
  } catch (err) {
    logger.warn('[IdentityVerification] saved proof results unavailable', { userId, error: err instanceof Error ? err.message : 'unknown' });
    return [];
  }
}

async function recordRun(userId: string, result: VerificationResult, trigger: RunTrigger): Promise<string | null> {
  try {
    const packed = encryptBytes(Buffer.from(JSON.stringify(result), 'utf8'));
    const row = await prisma.identityVerificationRun.create({
      data: {
        userId,
        pipelineVersion: result.pipelineVersion,
        trigger,
        status: result.status,
        riskScore: result.riskScore,
        documentTypes: result.audit.documentTypes.map((t) => t ?? 'UNRECOGNISED'),
        findingCodes: result.audit.findingCodes,
        stageStatuses: result.audit.stageStatuses,
        resultCipher: packed.cipher,
        encryptionKeyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    logger.warn('[IdentityVerification] run not recorded', { userId, error: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
}

/**
 * When the identity checks pass, keep the details that were read (encrypted, next
 * to the saved document) and fill the account's name from the ID. Nothing is
 * stored for a run that did not pass, and a failure here never blocks the person.
 */
async function persistVerifiedIdentity(userId: string, result: VerificationResult, runId: string | null, now: Date): Promise<void> {
  const data = buildVerifiedIdentityData(result, runId, now);
  if (!data) return;
  try {
    const packed = encryptBytes(Buffer.from(JSON.stringify(data), 'utf8'));
    const saved = await prisma.governmentIdRecord.updateMany({ where: { userId }, data: { identityDataCipher: packed.cipher } });
    if (data.fullName) await prisma.user.update({ where: { id: userId }, data: { fullName: data.fullName } });
    logger.info('[IdentityVerification] verified details kept', { userId, stored: saved.count > 0, nameFilled: Boolean(data.fullName), documents: data.documents.length });
  } catch (err) {
    logger.warn('[IdentityVerification] verified details not kept', { userId, error: err instanceof Error ? err.message : 'unknown' });
  }
}

export const identityVerificationService = {
  /**
   * Runs the full pipeline. Two passes: the first reads the document numbers so
   * their fingerprints can be checked against other accounts; the second is the
   * decision that is returned and recorded.
   */
  async verify(input: {
    userId: string;
    documents: UploadedDocument[];
    live?: LiveCapture | null;
    trigger: RunTrigger;
    now?: Date;
    /** Compare against the saved ID proof's earlier (encrypted) results, without re-reading the file. */
    includeSavedProof?: boolean;
  }): Promise<{ result: VerificationResult; runId: string | null }> {
    const now = input.now ?? new Date();
    const priorDocuments = input.includeSavedProof ? await savedProofReports(input.userId) : [];
    const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { fullName: true } });
    const claim = {
      userId: input.userId,
      fullName: user?.fullName && user.fullName !== 'PINIT User' ? user.fullName : null,
    };
    const documents = await Promise.all(input.documents.map(prepareDocument));

    const firstPass = runIdentityVerification({ now, claim, documents });
    firstPass.documents.forEach((r, i) => {
      documents[i]!.numberFingerprint = r.detectedType ? documentFingerprint(r.detectedType, r.fields) : null;
    });

    const [others, padVerdict, enrolled] = await Promise.all([
      fingerprintsOnOtherAccounts(input.userId, documents.map((d) => d.numberFingerprint ?? null)),
      padFor(input.live),
      input.live ? enrolledTemplate(input.userId) : Promise.resolve(null),
    ]);

    const result = runIdentityVerification({
      now, claim, documents, live: input.live ?? null, enrolledTemplate: enrolled,
      fingerprintsOnOtherAccounts: others, padVerdict, priorDocuments,
    });
    const runId = await recordRun(input.userId, result, input.trigger);
    logger.info('[IdentityVerification] run', {
      userId: input.userId,
      trigger: input.trigger,
      status: result.status,
      riskScore: result.riskScore,
      documentTypes: result.audit.documentTypes.join(','),
      findings: result.audit.findingCodes.length,
    });
    await persistVerifiedIdentity(input.userId, result, runId, now);
    return { result, runId };
  },

  /** Links a saved document's fingerprint to the account, so a second account using it is flagged. */
  async registerFingerprints(userId: string, result: VerificationResult): Promise<void> {
    for (const [i, fp] of result.audit.numberFingerprints.entries()) {
      const type = result.audit.documentTypes[i];
      if (!fp || !type) continue;
      try {
        await prisma.identityDocumentFingerprint.upsert({
          where: { fingerprint_userId: { fingerprint: fp, userId } },
          create: { fingerprint: fp, userId, documentType: type },
          update: {},
        });
      } catch (err) {
        logger.warn('[IdentityVerification] fingerprint not registered', { userId, error: err instanceof Error ? err.message : 'unknown' });
      }
    }
  },

  /** The owner's most recent run, decrypted. Null when none exists or storage is unavailable. */
  async latestForOwner(userId: string): Promise<{ id: string; createdAt: Date; result: VerificationResult } | null> {
    try {
      const row = await prisma.identityVerificationRun.findFirst({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        select: { id: true, createdAt: true, resultCipher: true },
      });
      if (!row) return null;
      const result = JSON.parse(decryptBytes(Buffer.from(row.resultCipher)).toString('utf8')) as VerificationResult;
      return { id: row.id, createdAt: row.createdAt, result };
    } catch (err) {
      logger.warn('[IdentityVerification] latest run unavailable', { userId, error: err instanceof Error ? err.message : 'unknown' });
      return null;
    }
  },
};

/** Masks document numbers for display (last 4 characters visible). */
function mask(value: string): string {
  const clean = value.replace(/\s/g, '');
  return clean.length <= 4 ? clean : `${'•'.repeat(Math.max(0, clean.length - 4))}${clean.slice(-4)}`;
}

/**
 * What the account owner sees. Numbers are masked on screen (shoulder-surfing),
 * the internal audit block and fingerprints are removed.
 */
export function ownerView(result: VerificationResult) {
  return {
    pipelineVersion: result.pipelineVersion,
    evaluatedAt: result.evaluatedAt,
    status: result.status,
    providerVerified: result.providerVerified,
    documentChecks: result.documentChecks,
    identityCorroborated: result.identityCorroborated,
    decisionBasis: result.decisionBasis,
    riskScore: result.riskScore,
    documents: result.documents.map((d) => ({
      ...d,
      fields: Object.fromEntries(Object.entries(d.fields).flatMap(([k, f]) => {
        if (!f || k === 'address' || k === 'fatherOrGuardianName' || k === 'motherName' || k === 'virtualId') return [];
        if (k === 'documentNumber') return [[k, { ...f, value: mask(f.value) }]];
        if (k === 'dateOfBirth' && /^\d{4}/.test(f.value)) return [[k, { ...f, value: `••/••/${f.value.slice(0, 4)}` }]];
        return [[k, f]];
      })),
    })),
    crossDocument: result.crossDocument,
    face: result.face,
    pad: result.pad,
    risks: result.risks,
    stages: result.stages,
    reasons: result.reasons,
  };
}
