/**
 * PINIT Identity Proof Intelligence — shared types.
 *
 * Stage order (fixed):
 *   Identity Claim → Document Identification → Information Extracted →
 *   Document Validated → Document Authenticity Signals → Cross-ID Consistency →
 *   Document Photo ↔ Live Face → PAD/Liveness → Live Face ↔ Enrolled PINIT Identity →
 *   Risk Assessment → Final Verification Decision → Audit Record
 *
 * Every stage reports PASS / FAIL / NOT_RUN / UNKNOWN with evidence.
 * OCR only reads text: "Information Extracted" is never identity verification.
 * A valid checksum or well-formed number is never proof that a document is genuine.
 * No government database is consulted: the strongest outcome is "Checks passed".
 */

export const PIPELINE_VERSION = 'idv-2.0.0';

export const IDENTITY_DOCUMENT_TYPES = [
  'PASSPORT',
  'AADHAAR',
  'PAN',
  'DRIVING_LICENCE',
  'VOTER_ID',
  'GOVERNMENT_ID',
] as const;
export type IdentityDocumentType = (typeof IDENTITY_DOCUMENT_TYPES)[number];

export const FIELD_NAMES = [
  'fullName',
  'fatherOrGuardianName',
  'motherName',
  'dateOfBirth',
  'yearOfBirth',
  'gender',
  'documentNumber',
  'nationality',
  'address',
  'issueDate',
  'expiryDate',
  'issuingAuthority',
  'issuingCountry',
  'placeOfBirth',
  'vehicleClasses',
  'virtualId',
  'electoralConstituency',
  'electoralPartNumber',
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

/** Where a value came from. MRZ and checksummed numbers are stronger than free OCR text. */
export type FieldSource = 'MRZ' | 'OCR' | 'PATTERN' | 'DEVICE' | 'CLAIM';

export interface ExtractedField {
  value: string;
  /** 0..1 — how sure the reader is that this is the right text, not that it is true. */
  confidence: number;
  source: FieldSource;
}

export type ExtractedFields = Partial<Record<FieldName, ExtractedField>>;

/** Visual parts of a document that are not text fields. */
export type DocumentElement = 'PHOTOGRAPH' | 'SIGNATURE' | 'MRZ';
export type ElementStatus = 'PRESENT' | 'MISSING' | 'NOT_CHECKED';
export interface ElementReport {
  status: ElementStatus;
  /** How presence was established, e.g. "face detected on the device" or "signature label read". */
  evidence: string;
}

export type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Stable machine codes. Messages are for people; codes are for rules and audit. */
export type FindingCode =
  | 'CLAIM_RECORDED'
  | 'TYPE_RECOGNISED'
  | 'TYPE_UNRECOGNISED'
  | 'TYPE_MISMATCH'
  | 'TYPE_REVIEW_ONLY'
  | 'FILE_UNREADABLE'
  | 'FILE_LOCKED'
  | 'TEXT_UNREADABLE'
  | 'FIELD_FOUND'
  | 'MISSING_FIELD'
  | 'ELEMENT_PRESENT'
  | 'ELEMENT_MISSING'
  | 'ELEMENT_NOT_CHECKED'
  | 'CHECKSUM_VALID'
  | 'CHECKSUM_INVALID'
  | 'NUMBER_STRUCTURE_VALID'
  | 'NUMBER_STRUCTURE_INVALID'
  | 'DATE_INVALID'
  | 'DATE_ORDER_INVALID'
  | 'DOCUMENT_EXPIRED'
  | 'DOCUMENT_NOT_EXPIRED'
  | 'UNDERAGE_FOR_DOCUMENT'
  | 'STRUCTURE_INCONSISTENT'
  | 'EDITING_SOFTWARE_METADATA'
  | 'PDF_EDITED_AFTER_CREATION'
  | 'LOW_RESOLUTION'
  | 'IMAGE_BLURRY'
  | 'SCREENSHOT_OR_SCREEN_CAPTURE'
  | 'MANIPULATION_DETECTOR_NOT_AVAILABLE'
  | 'NO_AUTHENTICITY_INDICATOR'
  | 'NAME_MATCH'
  | 'NAME_EXPECTED_VARIATION'
  | 'NAME_MISMATCH'
  | 'PARENT_NAME_CONSISTENT'
  | 'PARENT_NAME_MISMATCH'
  | 'DOB_MATCH'
  | 'DOB_EXPECTED_VARIATION'
  | 'DOB_MISMATCH'
  | 'GENDER_MATCH'
  | 'GENDER_MISMATCH'
  | 'ADDRESS_MATCH'
  | 'ADDRESS_PARTIAL'
  | 'ADDRESS_MISMATCH'
  | 'PAN_SURNAME_INITIAL_MATCH'
  | 'PAN_SURNAME_INITIAL_MISMATCH'
  | 'SAME_DOCUMENT_TWICE'
  | 'DUPLICATE_DOCUMENT_OTHER_ACCOUNT'
  | 'SINGLE_DOCUMENT_ONLY'
  | 'DOCUMENT_FACE_USABLE'
  | 'DOCUMENT_FACE_POOR'
  | 'DOCUMENT_FACE_NOT_FOUND'
  | 'DOCUMENT_FACE_NOT_PROVIDED'
  | 'FACE_MATCH'
  | 'FACE_NO_MATCH'
  | 'LIVE_FACE_NOT_PROVIDED'
  | 'ENROLLED_MATCH'
  | 'ENROLLED_NO_MATCH'
  | 'ENROLLED_NOT_AVAILABLE'
  | 'PAD_LIVE'
  | 'PAD_SPOOF'
  | 'PAD_UNKNOWN'
  | 'PAD_NOT_RUN'
  | 'IDENTITY_CORROBORATED'
  | 'IDENTITY_NOT_CORROBORATED'
  | 'PROVIDER_NOT_INTEGRATED';

export interface Finding {
  code: FindingCode;
  severity: Severity;
  message: string;
  /** Which document this is about (index into the submitted list), if any. */
  documentIndex?: number;
  field?: FieldName;
  /** Short, non-identifying facts that back the finding (never raw numbers or OCR text). */
  evidence?: string[];
}

export const STAGE_ORDER = [
  'IDENTITY_CLAIM',
  'DOCUMENT_IDENTIFICATION',
  'INFORMATION_EXTRACTED',
  'DOCUMENT_VALIDATED',
  'DOCUMENT_AUTHENTICITY_SIGNALS',
  'CROSS_ID_CONSISTENCY',
  'DOCUMENT_PHOTO_VS_LIVE_FACE',
  'PAD_LIVENESS',
  'LIVE_FACE_VS_ENROLLED',
  'RISK_ASSESSMENT',
  'VERIFICATION_DECISION',
  'AUDIT_RECORD',
] as const;
export type StageName = (typeof STAGE_ORDER)[number];

/** Exactly four outcomes. UNKNOWN = ran, but could not establish a pass or a fail. */
export type StageStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNKNOWN';

export interface StageResult {
  stage: StageName;
  status: StageStatus;
  summary: string;
  /** Short facts backing the status (never raw numbers or OCR text). */
  evidence: string[];
  findings: Finding[];
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface IdentityClaim {
  userId: string;
  fullName?: string | null;
  dateOfBirth?: string | null; // ISO yyyy-mm-dd
  gender?: string | null;
}

/** A document after file handling: text has already been read (PDF text or OCR). */
export interface DocumentInput {
  /** What the person said this is. The pipeline still classifies and compares. */
  declaredType?: IdentityDocumentType | null;
  mimeType: string | null;
  bytes: Buffer;
  extractedText: string;
  fileSignals?: FileSignals;
  /**
   * Face found on the document photograph by the device (face-api-v1).
   * undefined = the document photo was not examined (e.g. a PDF);
   * null = examined and no face was found.
   */
  documentFace?: DeviceFace | null;
  /** Keyed hash of the normalised document number, filled by the service. */
  numberFingerprint?: string | null;
}

export interface FileSignals {
  locked?: boolean;
  intact?: boolean;
  widthPx?: number;
  heightPx?: number;
  /** Mean |Laplacian| on edge pixels; low = blurry. */
  sharpness?: number;
  editingSoftware?: string | null;
  pdfIncrementalUpdates?: number;
  looksLikeScreenshot?: boolean;
}

export interface DeviceFace {
  /** 128-d face-api-v1 embedding computed on the device. */
  embedding: number[];
  /** 0..1 detector score. */
  detectionScore?: number;
  /** Face box size as a fraction of the image's shorter side. */
  relativeSize?: number;
}

export interface LiveCapture {
  /** 128-d face-api-v1 embedding of the live face. */
  embedding: number[];
  padEvidence?: unknown;
}

export type PadVerdict = 'LIVE' | 'SPOOF' | 'UNKNOWN';

export interface PipelineContext {
  now: Date;
  claim: IdentityClaim;
  documents: DocumentInput[];
  live?: LiveCapture | null;
  /** Enrolled PINIT template for 1:1, if the account has one. */
  enrolledTemplate?: number[] | null;
  /** Fingerprints already registered to OTHER accounts (duplicate check). */
  fingerprintsOnOtherAccounts?: Set<string>;
  /** Verdict from the existing passive PAD engine on the live capture. */
  padVerdict?: { verdict: PadVerdict; reasons?: string[] } | null;
  /**
   * Documents checked in an earlier run (from that run's encrypted record), e.g.
   * the saved ID proof. Used only for Cross-ID consistency; they are not re-read.
   */
  priorDocuments?: DocumentReport[];
}

// ── Output ───────────────────────────────────────────────────────────────────

export type VerificationStatus = 'CHECKS_PASSED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'INSUFFICIENT_EVIDENCE';

export interface DocumentReport {
  index: number;
  /** SUBMITTED in this run, or SAVED_PROOF carried over from an earlier run's record. */
  origin?: 'SUBMITTED' | 'SAVED_PROOF';
  declaredType: IdentityDocumentType | null;
  detectedType: IdentityDocumentType | null;
  typeConfidence: number;
  /** The selected type disagreed with what the document looks like. */
  typeMismatch: boolean;
  fields: ExtractedFields;
  /** Fields this document type normally carries but which were not found. */
  missingFields: FieldName[];
  elements: Partial<Record<DocumentElement, ElementReport>>;
  /** Document Validated stage, for this document. */
  validation: StageStatus;
  expired: boolean | null;
  /** 0..1 — drops with each authenticity indicator. Never proof of authenticity. */
  authenticityConfidence: number;
}

export interface FaceResult {
  documentPhoto: 'USABLE_FACE' | 'POOR_FACE' | 'NO_FACE' | 'NOT_PROVIDED';
  documentPhotoVsLive: StageStatus;
  documentPhotoVsLiveDistance?: number;
  liveVsEnrolled: StageStatus;
  liveVsEnrolledDistance?: number;
  /** Where the embeddings came from. Device embeddings are advisory. */
  embeddingSource: 'DEVICE_FACE_API_V1' | 'NONE';
}

export interface PadResult {
  status: PadVerdict | 'NOT_RUN';
  reasons: string[];
}

export interface RiskIndicator {
  category:
    | 'DOCUMENT_MANIPULATION'
    | 'INCONSISTENT_IDENTITY'
    | 'EXPIRED_DOCUMENT'
    | 'INVALID_STRUCTURE'
    | 'SUSPICIOUS_PHOTO'
    | 'DUPLICATE_DOCUMENT'
    | 'POSSIBLE_IMPERSONATION'
    | 'FACE_MISMATCH'
    | 'LIVENESS_FAILED'
    | 'MISSING_OR_UNREADABLE';
  severity: Severity;
  reason: string;
  sourceCodes: FindingCode[];
}

export interface DecisionBasis {
  stage: StageName;
  status: StageStatus;
  codes: FindingCode[];
}

export interface VerificationResult {
  pipelineVersion: string;
  evaluatedAt: string;
  status: VerificationStatus;
  /** Always false: no government or issuer database is consulted. */
  providerVerified: false;
  /** Outcome of the document checks alone (validation + authenticity signals). */
  documentChecks: StageStatus;
  /** Whether something independent of a single document backs the identity. */
  identityCorroborated: boolean;
  riskScore: number; // 0..100, higher = riskier
  documents: DocumentReport[];
  crossDocument: { comparedPairs: number; consistent: boolean | null; findings: Finding[] };
  face: FaceResult;
  pad: PadResult;
  risks: RiskIndicator[];
  stages: StageResult[];
  /** One reason per decision, in plain words. */
  reasons: string[];
  /** Which stages and codes produced the decision. */
  decisionBasis: DecisionBasis[];
  audit: AuditRecord;
}

export interface AuditRecord {
  pipelineVersion: string;
  evaluatedAt: string;
  userId: string;
  declaredTypes: Array<IdentityDocumentType | null>;
  documentTypes: Array<IdentityDocumentType | null>;
  /** Keyed hashes only — never raw document numbers. */
  numberFingerprints: Array<string | null>;
  stageStatuses: Record<StageName, StageStatus>;
  findingCodes: FindingCode[];
  status: VerificationStatus;
  decisionCodes: FindingCode[];
  riskScore: number;
  faceEmbeddingSource: FaceResult['embeddingSource'];
}
