/**
 * PINIT Identity Proof Intelligence pipeline. Pure: no database, no network,
 * no logging of personal data. The service layer gathers inputs (text, file
 * signals, device faces, PAD verdict, enrolled template, duplicate fingerprints)
 * and stores the audit record.
 *
 *   Identity Claim → Document Identification → Information Extracted →
 *   Document Validated → Document Authenticity Signals → Cross-ID Consistency →
 *   Document Photo ↔ Live Face → PAD/Liveness → Live Face ↔ Enrolled PINIT Identity →
 *   Risk Assessment → Final Verification Decision → Audit Record
 *
 * Rules that shape the decision:
 * - Reading text is not verification. Valid checksums are not proof of genuineness.
 * - One document, however clean, never reaches "Checks passed" on its own: the
 *   identity must be corroborated by a second consistent document, or by the
 *   document photo matching a live face that passed liveness.
 * - Liveness and face similarity are reported separately, never as one score.
 */
import { euclideanDistance, normalizeEmbedding, THRESHOLDS, verifyClaimedFace } from '../auth/biometric-matching.service';
import { adapterFor, classify } from './registry';
import { authenticityConfidence, authenticityFindings } from './authenticity';
import { crossDocumentFindings } from './cross-document';
import { impossibleDateFindings } from './adapters/rules';
import type {
  AuditRecord, DecisionBasis, DocumentElement, DocumentReport, ElementReport, FaceResult, Finding, FindingCode,
  PadResult, PipelineContext, RiskIndicator, Severity, StageName, StageResult, StageStatus, VerificationResult,
  VerificationStatus,
} from './types';
import { PIPELINE_VERSION, STAGE_ORDER } from './types';

const FACE_DIM = 128;
/** A document face smaller than this share of the image, or below this detector score, is poor. */
const MIN_DOC_FACE_SIZE = 0.08;
const MIN_DOC_FACE_SCORE = 0.5;

const VALIDATION_FAIL: FindingCode[] = [
  'CHECKSUM_INVALID', 'NUMBER_STRUCTURE_INVALID', 'DATE_INVALID', 'DATE_ORDER_INVALID', 'DOCUMENT_EXPIRED',
  'UNDERAGE_FOR_DOCUMENT', 'STRUCTURE_INCONSISTENT',
];

function stage(name: StageName, status: StageStatus, summary: string, evidence: string[], findings: Finding[] = []): StageResult {
  return { stage: name, status, summary, evidence, findings };
}

const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
function worst(findings: Finding[]): Severity | null {
  for (const s of SEVERITY_ORDER) if (findings.some((f) => f.severity === s)) return s;
  return null;
}

/**
 * HIGH/CRITICAL → FAIL; MEDIUM → UNKNOWN (needs a person to decide).
 * LOW indicators are recorded and shown but do not change a stage's outcome.
 */
function statusFrom(findings: Finding[]): StageStatus {
  const w = worst(findings);
  if (w === 'CRITICAL' || w === 'HIGH') return 'FAIL';
  if (w === 'MEDIUM') return 'UNKNOWN';
  return 'PASS';
}

function combine(statuses: StageStatus[]): StageStatus {
  if (!statuses.length) return 'NOT_RUN';
  if (statuses.includes('FAIL')) return 'FAIL';
  if (statuses.includes('UNKNOWN')) return 'UNKNOWN';
  if (statuses.every((s) => s === 'NOT_RUN')) return 'NOT_RUN';
  return 'PASS';
}

function validEmbedding(v: unknown): v is number[] {
  return Array.isArray(v) && v.length === FACE_DIM && v.every((x) => typeof x === 'number' && Number.isFinite(x));
}

export function runIdentityVerification(ctx: PipelineContext): VerificationResult {
  const stages: StageResult[] = [];
  const now = ctx.now;
  const docs = ctx.documents;

  // ── 1. Identity Claim ─────────────────────────────────────────────────────
  stages.push(stage('IDENTITY_CLAIM', docs.length ? 'PASS' : 'UNKNOWN',
    docs.length ? `${docs.length} document(s) submitted for this claim.` : 'No documents were submitted.',
    [`PINIT account`, ctx.claim.fullName ? 'profile name present' : 'no profile name', `${docs.length} document(s)`],
    [{ code: 'CLAIM_RECORDED', severity: 'INFO', message: 'The claim is what is being checked. It is not evidence.' }]));

  // ── 2. Document Identification ────────────────────────────────────────────
  const idFindings: Finding[] = [];
  const idStatuses: StageStatus[] = [];
  const classified = docs.map((doc, index) => {
    const c = classify(doc.extractedText, doc.declaredType ?? null);
    const words = doc.extractedText.trim().split(/\s+/).filter(Boolean).length;
    const n = `Document #${index + 1}`;
    let status: StageStatus = 'PASS';
    if (doc.fileSignals?.locked) {
      idFindings.push({ code: 'FILE_LOCKED', severity: 'HIGH', message: `${n}: the PDF is password-locked, so nothing on it can be read. Upload a photo or screenshot instead.`, documentIndex: index });
      status = 'UNKNOWN';
    } else if (doc.fileSignals?.intact === false) {
      idFindings.push({ code: 'FILE_UNREADABLE', severity: 'HIGH', message: `${n}: the file is damaged or not a supported image/PDF.`, documentIndex: index });
      status = 'UNKNOWN';
    } else if (words < 2) {
      idFindings.push({ code: 'TEXT_UNREADABLE', severity: 'HIGH', message: `${n}: no readable text was found. Use a sharper, well-lit photo of the document.`, documentIndex: index });
      status = 'UNKNOWN';
    }
    if (c.type) {
      const adapter = adapterFor(c.type)!;
      idFindings.push({ code: 'TYPE_RECOGNISED', severity: 'INFO', message: `${n}: identified as ${adapter.label} from its content (${Math.round(c.confidence * 100)}%).`, documentIndex: index, evidence: c.evidence });
      if (!adapter.structureKnown) {
        idFindings.push({ code: 'TYPE_REVIEW_ONLY', severity: 'MEDIUM', message: `${n}: an officially issued ID without a dedicated adapter. Its structure is not known, so it needs review.`, documentIndex: index });
        if (status === 'PASS') status = 'UNKNOWN';
      }
    } else if (status === 'PASS') {
      idFindings.push({ code: 'TYPE_UNRECOGNISED', severity: 'HIGH', message: `${n}: this does not look like any supported identity document.`, documentIndex: index, evidence: c.evidence });
      status = 'FAIL';
    }
    if (c.declaredMismatch) {
      idFindings.push({
        code: 'TYPE_MISMATCH', severity: 'HIGH',
        message: `${n}: selected as ${adapterFor(c.declaredMismatch.declared)!.label}, but its content identifies it as ${adapterFor(c.declaredMismatch.looksLike)!.label}.`,
        documentIndex: index, evidence: [`selected ${c.declaredMismatch.declared}`, `detected ${c.declaredMismatch.looksLike}`],
      });
      status = 'FAIL';
    }
    idStatuses.push(status);
    return { doc, index, c };
  });
  const recognisedCount = classified.filter((x) => x.c.type).length;
  stages.push(stage('DOCUMENT_IDENTIFICATION', combine(idStatuses),
    `${recognisedCount} of ${docs.length} document(s) identified from their content; the selected type is compared, not trusted.`,
    classified.map(({ index, c, doc }) => `#${index + 1}: selected ${doc.declaredType ?? 'none'}, detected ${c.type ?? 'unrecognised'}`),
    idFindings));

  // ── 3. Information Extracted ──────────────────────────────────────────────
  const extractFindings: Finding[] = [];
  const reports: DocumentReport[] = classified.map(({ doc, index, c }) => {
    const adapter = c.type ? adapterFor(c.type) : null;
    const fields = adapter ? adapter.extract(doc.extractedText, { now, documentIndex: index }) : {};
    const missing = adapter ? adapter.expectedFields.filter((f) => !fields[f]) : [];
    if (adapter) {
      extractFindings.push({
        code: 'FIELD_FOUND', severity: 'INFO',
        message: `${adapter.label} #${index + 1}: read ${Object.keys(fields).length} field(s)${missing.length ? `; not found on this document: ${missing.length}` : ''}.`,
        documentIndex: index,
        evidence: Object.entries(fields).map(([k, v]) => `${k} via ${v!.source}`),
      });
    }
    return {
      index,
      origin: 'SUBMITTED',
      declaredType: doc.declaredType ?? null,
      detectedType: c.type,
      typeConfidence: +c.confidence.toFixed(2),
      typeMismatch: Boolean(c.declaredMismatch),
      fields,
      missingFields: missing,
      elements: {},
      validation: 'NOT_RUN',
      expired: null,
      authenticityConfidence: 0,
    };
  });
  const anyFields = reports.some((r) => Object.keys(r.fields).length);
  stages.push(stage('INFORMATION_EXTRACTED',
    !recognisedCount ? 'NOT_RUN' : reports.every((r) => !r.detectedType || Object.keys(r.fields).length) ? 'PASS' : anyFields ? 'UNKNOWN' : 'FAIL',
    'Text was read from the documents. Reading text is not verification.',
    reports.filter((r) => r.detectedType).map((r) => `#${r.index + 1}: ${Object.keys(r.fields).length} field(s) read, ${r.missingFields.length} expected but not found`),
    extractFindings));

  // ── 4. Document Validated ─────────────────────────────────────────────────
  const valFindings: Finding[] = [];
  for (const r of reports) {
    const adapter = r.detectedType ? adapterFor(r.detectedType) : null;
    if (!adapter) continue;
    const doc = docs[r.index]!;
    const own = [
      ...adapter.validate(r.fields, { now, documentIndex: r.index }, doc.extractedText),
      ...impossibleDateFindings(adapter.label, doc.extractedText, r.index),
    ];
    const failed = own.some((f) => VALIDATION_FAIL.includes(f.code));
    const incomplete = own.some((f) => f.code === 'MISSING_FIELD' || f.severity === 'MEDIUM') || !adapter.structureKnown;
    r.validation = failed ? 'FAIL' : incomplete ? 'UNKNOWN' : 'PASS';
    r.expired = own.some((f) => f.code === 'DOCUMENT_EXPIRED') ? true : own.some((f) => f.code === 'DOCUMENT_NOT_EXPIRED') ? false : null;
    valFindings.push(...own);
  }
  stages.push(stage('DOCUMENT_VALIDATED', combine(reports.filter((r) => r.detectedType).map((r) => r.validation)),
    'Required fields, number formats, checksums and dates. A valid checksum or format is not proof that a document is genuine.',
    reports.filter((r) => r.detectedType).map((r) => `#${r.index + 1}: ${r.validation}`),
    valFindings));

  // ── 5. Document Authenticity Signals ──────────────────────────────────────
  const authFindings: Finding[] = [];
  for (const r of reports) {
    const doc = docs[r.index]!;
    const adapter = r.detectedType ? adapterFor(r.detectedType) : null;
    const label = adapter ? `${adapter.label} #${r.index + 1}` : `Document #${r.index + 1}`;
    const own: Finding[] = authenticityFindings(doc.fileSignals, r.index, label);

    // Expected elements: photograph (device face detection), signature (label), MRZ (adapter).
    if (adapter) {
      const read = adapter.readElements?.(doc.extractedText) ?? {};
      for (const el of adapter.expectedElements) {
        const report = elementReport(el, doc, read);
        r.elements[el] = report;
        if (report.status === 'MISSING') {
          // A device face detector often misses small ID photos, so a missing photograph is a
          // low-severity indicator; a missing MRZ or other text-read element is medium.
          own.push({ code: 'ELEMENT_MISSING', severity: el === 'PHOTOGRAPH' ? 'LOW' : 'MEDIUM', message: `${label}: expected ${el.toLowerCase()} not found (${report.evidence}).`, documentIndex: r.index, evidence: [el] });
        } else if (report.status === 'PRESENT') {
          own.push({ code: 'ELEMENT_PRESENT', severity: 'INFO', message: `${label}: ${el.toLowerCase()} present (${report.evidence}).`, documentIndex: r.index, evidence: [el] });
        }
      }
    }
    const indicators = own.filter((f) => f.severity !== 'INFO');
    r.authenticityConfidence = adapter ? authenticityConfidence([...indicators, ...valFindings.filter((f) => f.documentIndex === r.index)]) : 0;
    if (adapter && !indicators.length) {
      own.push({ code: 'NO_AUTHENTICITY_INDICATOR', severity: 'INFO', message: `${label}: no authenticity indicator found among the signals checked.`, documentIndex: r.index });
    }
    authFindings.push(...own);
  }
  authFindings.push({
    code: 'MANIPULATION_DETECTOR_NOT_AVAILABLE', severity: 'INFO',
    message: 'Pixel-level image-manipulation detection is not available; only metadata, structure, quality and expected elements were checked.',
  });
  const authIndicators = authFindings.filter((f) => f.severity !== 'INFO');
  stages.push(stage('DOCUMENT_AUTHENTICITY_SIGNALS',
    !recognisedCount && !authIndicators.length ? 'NOT_RUN'
      : authIndicators.some((f) => f.code === 'FILE_UNREADABLE') ? 'FAIL'
        : authIndicators.some((f) => f.severity !== 'LOW') ? 'UNKNOWN' : 'PASS',
    'Risk indicators only, never proof of fraud or of genuineness.',
    ['checked: editing-software metadata, PDF edits after creation, locked PDF, screenshot, blur, resolution, expected elements', 'not available: pixel-level manipulation detection'],
    authFindings));

  // ── 6. Cross-ID Consistency ───────────────────────────────────────────────
  // A saved proof checked in an earlier run joins the comparison only if it passed validation then.
  const prior: DocumentReport[] = (ctx.priorDocuments ?? [])
    .filter((p) => p.detectedType && p.validation === 'PASS')
    .map((p, k) => ({ ...p, index: reports.length + k, origin: 'SAVED_PROOF' }));
  const crossReports = [...reports, ...prior];
  const cross = crossDocumentFindings(crossReports, ctx.claim);
  const fingerprints = docs.map((d) => d.numberFingerprint ?? null);
  const dupFindings: Finding[] = [];
  fingerprints.forEach((fp, i) => {
    if (fp && ctx.fingerprintsOnOtherAccounts?.has(fp)) {
      dupFindings.push({ code: 'DUPLICATE_DOCUMENT_OTHER_ACCOUNT', severity: 'CRITICAL', message: `Document #${i + 1}: this document number is already linked to another PINIT account.`, documentIndex: i });
    }
  });
  const distinctDocs = new Set(crossReports.filter((r) => r.detectedType && r.detectedType !== 'GOVERNMENT_ID')
    .map((r) => `${r.detectedType}:${r.fields.documentNumber?.value ?? r.index}`)).size;
  const crossAll = [...cross.findings, ...dupFindings];
  if (distinctDocs < 2) {
    crossAll.push({ code: 'SINGLE_DOCUMENT_ONLY', severity: 'INFO', message: 'Only one distinct identity document was provided, so documents could not be compared with each other.' });
  }
  const crossStatus: StageStatus = dupFindings.length
    ? 'FAIL'
    : cross.comparedPairs && distinctDocs >= 2
      ? statusFrom(cross.findings)
      : cross.findings.some((f) => f.severity === 'HIGH') ? 'FAIL' : 'NOT_RUN';
  stages.push(stage('CROSS_ID_CONSISTENCY', crossStatus,
    distinctDocs >= 2 ? `${cross.comparedPairs} document pair(s) compared, plus the profile name.` : 'One document: compared with the profile name only.',
    [`${distinctDocs} distinct document(s)`, `${cross.comparedPairs} pair(s) compared`, ...(prior.length ? [`${prior.length} saved proof(s) from an earlier check`] : [])],
    crossAll));

  // ── 7. Document Photo ↔ Live Face ─────────────────────────────────────────
  const live = ctx.live && validEmbedding(ctx.live.embedding) ? ctx.live.embedding : null;
  const docFaces = docs.map((d) => d.documentFace);
  const usableDocFace = docFaces.find((f) => f && validEmbedding(f.embedding)) ?? null;
  const face: FaceResult = {
    documentPhoto: usableDocFace
      ? ((usableDocFace.relativeSize ?? 1) < MIN_DOC_FACE_SIZE || (usableDocFace.detectionScore ?? 1) < MIN_DOC_FACE_SCORE ? 'POOR_FACE' : 'USABLE_FACE')
      : docFaces.some((f) => f === null) ? 'NO_FACE' : 'NOT_PROVIDED',
    documentPhotoVsLive: 'NOT_RUN',
    liveVsEnrolled: 'NOT_RUN',
    embeddingSource: usableDocFace || live ? 'DEVICE_FACE_API_V1' : 'NONE',
  };
  const docFaceFindings: Finding[] = [];
  docFaceFindings.push(
    face.documentPhoto === 'USABLE_FACE' ? { code: 'DOCUMENT_FACE_USABLE', severity: 'INFO', message: 'A usable face was found on the document photograph (detected on the device).' }
      : face.documentPhoto === 'POOR_FACE' ? { code: 'DOCUMENT_FACE_POOR', severity: 'LOW', message: 'The face on the document photograph is small or unclear.' }
        : face.documentPhoto === 'NO_FACE' ? { code: 'DOCUMENT_FACE_NOT_FOUND', severity: 'LOW', message: 'The document photograph was examined, but no face could be found on it (small ID photos are often missed).' }
          : { code: 'DOCUMENT_FACE_NOT_PROVIDED', severity: 'INFO', message: 'The document photograph was not provided for face comparison (for example, a PDF upload).' },
  );
  let docLiveEvidence: string[] = [`document photo: ${face.documentPhoto}`, live ? 'live face provided' : 'no live face'];
  if (live && usableDocFace) {
    const dist = euclideanDistance(normalizeEmbedding(live), normalizeEmbedding(usableDocFace.embedding));
    face.documentPhotoVsLiveDistance = +dist.toFixed(3);
    const match = dist < THRESHOLDS.faceLogin;
    face.documentPhotoVsLive = match ? 'PASS' : face.documentPhoto === 'POOR_FACE' ? 'UNKNOWN' : 'FAIL';
    docLiveEvidence = [...docLiveEvidence, `distance ${dist.toFixed(3)} vs threshold ${THRESHOLDS.faceLogin}`, 'embeddings computed on the device (face-api-v1)'];
    docFaceFindings.push(match
      ? { code: 'FACE_MATCH', severity: 'INFO', message: 'The live face matches the face on the document photograph.', evidence: [`distance ${dist.toFixed(3)}`] }
      : { code: 'FACE_NO_MATCH', severity: face.documentPhoto === 'POOR_FACE' ? 'MEDIUM' : 'HIGH', message: 'The live face does not match the document photograph. Document photos can be old, so a person should review this.', evidence: [`distance ${dist.toFixed(3)}`] });
  } else if (!live) {
    docFaceFindings.push({ code: 'LIVE_FACE_NOT_PROVIDED', severity: 'INFO', message: 'No live face was captured, so the document photograph was not compared.' });
  }
  stages.push(stage('DOCUMENT_PHOTO_VS_LIVE_FACE', face.documentPhotoVsLive,
    face.documentPhotoVsLive === 'NOT_RUN'
      ? 'Not run: comparison needs both a usable document photograph and a live face.'
      : 'Document photograph compared with the live face.',
    docLiveEvidence, docFaceFindings));

  // ── 8. PAD / Liveness ─────────────────────────────────────────────────────
  const pad: PadResult = { status: 'NOT_RUN', reasons: [] };
  const padFindings: Finding[] = [];
  if (live && ctx.padVerdict) {
    pad.status = ctx.padVerdict.verdict;
    pad.reasons = ctx.padVerdict.reasons ?? [];
    padFindings.push(pad.status === 'LIVE'
      ? { code: 'PAD_LIVE', severity: 'INFO', message: 'LIVE: the live capture passed presentation-attack detection.' }
      : pad.status === 'SPOOF'
        ? { code: 'PAD_SPOOF', severity: 'CRITICAL', message: 'SPOOF: the live capture looks like a photo, screen or mask.', evidence: pad.reasons }
        : { code: 'PAD_UNKNOWN', severity: 'HIGH', message: 'UNKNOWN: there was not enough evidence to decide liveness.', evidence: pad.reasons });
  } else {
    padFindings.push({ code: 'PAD_NOT_RUN', severity: 'INFO', message: 'No live capture, so liveness was not checked.' });
  }
  stages.push(stage('PAD_LIVENESS',
    pad.status === 'NOT_RUN' ? 'NOT_RUN' : pad.status === 'LIVE' ? 'PASS' : pad.status === 'SPOOF' ? 'FAIL' : 'UNKNOWN',
    `Liveness of the live capture: ${pad.status}. Reported separately from any face similarity.`,
    [`verdict ${pad.status}`, ...pad.reasons.map((r) => `reason ${r}`)], padFindings));

  // ── 9. Live Face ↔ Enrolled PINIT Identity ────────────────────────────────
  const enrolledFindings: Finding[] = [];
  let enrolledEvidence: string[] = [live ? 'live face provided' : 'no live face'];
  if (live && ctx.enrolledTemplate && validEmbedding(ctx.enrolledTemplate)) {
    const v = verifyClaimedFace({ claimedUserId: ctx.claim.userId, probe: live, enrolled: ctx.enrolledTemplate });
    face.liveVsEnrolled = v.ok ? 'PASS' : 'FAIL';
    if (v.ok) face.liveVsEnrolledDistance = +v.distance.toFixed(3);
    enrolledEvidence = [...enrolledEvidence, '1:1 against this account only', v.ok ? `distance ${v.distance.toFixed(3)}` : `reason ${v.reason}`];
    enrolledFindings.push(v.ok
      ? { code: 'ENROLLED_MATCH', severity: 'INFO', message: 'The live face matches the face enrolled on this PINIT account (1:1).' }
      : { code: 'ENROLLED_NO_MATCH', severity: 'CRITICAL', message: 'The live face does not match the face enrolled on this PINIT account.', evidence: [v.reason] });
  } else if (live) {
    enrolledEvidence = [...enrolledEvidence, 'no enrolled face on this account'];
    enrolledFindings.push({ code: 'ENROLLED_NOT_AVAILABLE', severity: 'INFO', message: 'This account has no enrolled face to compare with.' });
  }
  stages.push(stage('LIVE_FACE_VS_ENROLLED', face.liveVsEnrolled,
    face.liveVsEnrolled === 'NOT_RUN' ? 'Not run: needs a live face and an enrolled PINIT face.' : 'Live face compared 1:1 with the enrolled PINIT face.',
    enrolledEvidence, enrolledFindings));

  // ── 10. Risk Assessment ───────────────────────────────────────────────────
  const all = stages.flatMap((s) => s.findings);
  const risks = assessRisks(all);
  const riskScore = Math.min(100, risks.reduce((s, r) => s + RISK_POINTS[r.severity], 0));
  stages.push(stage('RISK_ASSESSMENT',
    risks.some((r) => r.severity === 'CRITICAL' || r.severity === 'HIGH') ? 'FAIL' : risks.length ? 'UNKNOWN' : 'PASS',
    risks.length ? `${risks.length} risk indicator(s), score ${riskScore}/100.` : 'No risk indicators.',
    risks.map((r) => `${r.category} (${r.severity})`)));

  // ── 11. Final Verification Decision ───────────────────────────────────────
  const documentChecks = combine([stages[3]!.status, stages[4]!.status].filter((s) => s !== 'NOT_RUN'));
  const corroboration = corroborate(stages, face, pad, distinctDocs);
  const { status, reasons, codes } = decide({ reports, risks, documentChecks, corroboration, recognisedCount });
  const decisionBasis = basisFor(stages, status);
  stages.push(stage('VERIFICATION_DECISION',
    status === 'CHECKS_PASSED' ? 'PASS' : status === 'REJECTED' ? 'FAIL' : 'UNKNOWN',
    reasons[0] ?? '',
    decisionBasis.map((b) => `${b.stage}: ${b.status}`),
    [
      corroboration.ok
        ? { code: 'IDENTITY_CORROBORATED', severity: 'INFO', message: `Identity corroborated by ${corroboration.by}.` }
        : { code: 'IDENTITY_NOT_CORROBORATED', severity: 'INFO', message: 'Identity is not corroborated: one document alone cannot establish identity. Add a second ID proof, or match your face to the document photo.' },
      { code: 'PROVIDER_NOT_INTEGRATED', severity: 'INFO', message: 'No government or issuer database was consulted. "Checks passed" is not a government verification.' },
    ]));

  // ── 12. Audit Record ──────────────────────────────────────────────────────
  const evaluatedAt = now.toISOString();
  stages.push(stage('AUDIT_RECORD', 'PASS', 'Decision, checks, reason codes and versions recorded without images or raw document numbers.',
    [`pipeline ${PIPELINE_VERSION}`, `${stages.length + 1} stages`]));
  const audit: AuditRecord = {
    pipelineVersion: PIPELINE_VERSION,
    evaluatedAt,
    userId: ctx.claim.userId,
    declaredTypes: reports.map((r) => r.declaredType),
    documentTypes: reports.map((r) => r.detectedType),
    numberFingerprints: fingerprints,
    stageStatuses: Object.fromEntries(stages.map((s) => [s.stage, s.status])) as AuditRecord['stageStatuses'],
    findingCodes: Array.from(new Set(stages.flatMap((s) => s.findings.map((f) => f.code)))),
    status,
    decisionCodes: codes,
    riskScore,
    faceEmbeddingSource: face.embeddingSource,
  };

  return {
    pipelineVersion: PIPELINE_VERSION,
    evaluatedAt,
    status,
    providerVerified: false,
    documentChecks,
    identityCorroborated: corroboration.ok,
    riskScore,
    documents: [...reports, ...prior],
    crossDocument: {
      comparedPairs: cross.comparedPairs,
      consistent: distinctDocs >= 2 ? !crossAll.some((f) => f.severity === 'HIGH' || f.severity === 'CRITICAL') : null,
      findings: crossAll,
    },
    face,
    pad,
    risks,
    stages,
    reasons,
    decisionBasis,
    audit,
  };
}

function elementReport(el: DocumentElement, doc: PipelineContext['documents'][number], read: Partial<Record<DocumentElement, ElementReport>>): ElementReport {
  if (read[el]) return read[el]!;
  if (el === 'PHOTOGRAPH') {
    if (doc.documentFace === null) return { status: 'MISSING', evidence: 'no face could be detected on the document' };
    if (doc.documentFace && validEmbedding(doc.documentFace.embedding)) return { status: 'PRESENT', evidence: 'face detected on the device' };
    return { status: 'NOT_CHECKED', evidence: 'the document image was not examined for a photo' };
  }
  if (el === 'SIGNATURE') {
    // OCR cannot see a handwritten signature; it can only read its printed label.
    return /\b(signature|sign\.?)\b|हस्ताक्षर/i.test(doc.extractedText)
      ? { status: 'PRESENT', evidence: 'signature label read; the signature itself is not checked' }
      : { status: 'NOT_CHECKED', evidence: 'signatures cannot be detected from text' };
  }
  return { status: 'NOT_CHECKED', evidence: 'not checked' };
}

/** What, besides a single document, backs the identity. */
function corroborate(stages: StageResult[], face: FaceResult, pad: PadResult, distinctDocs: number): { ok: boolean; by: string } {
  const cross = stages.find((s) => s.stage === 'CROSS_ID_CONSISTENCY')!;
  if (distinctDocs >= 2 && cross.status === 'PASS') return { ok: true, by: 'a second, consistent identity document' };
  if (face.documentPhotoVsLive === 'PASS' && pad.status === 'LIVE') return { ok: true, by: 'the document photograph matching a live face that passed liveness' };
  return { ok: false, by: '' };
}

// ── Risk rules ───────────────────────────────────────────────────────────────

const RISK_POINTS: Record<Severity, number> = { INFO: 0, LOW: 5, MEDIUM: 15, HIGH: 30, CRITICAL: 60 };

const RISK_MAP: Array<{ category: RiskIndicator['category']; codes: FindingCode[]; reason: string }> = [
  { category: 'DOCUMENT_MANIPULATION', codes: ['EDITING_SOFTWARE_METADATA', 'PDF_EDITED_AFTER_CREATION', 'CHECKSUM_INVALID', 'STRUCTURE_INCONSISTENT'], reason: 'Signs the file or its details may have been altered.' },
  { category: 'INVALID_STRUCTURE', codes: ['NUMBER_STRUCTURE_INVALID', 'DATE_INVALID', 'DATE_ORDER_INVALID', 'UNDERAGE_FOR_DOCUMENT', 'TYPE_UNRECOGNISED', 'TYPE_MISMATCH', 'TYPE_REVIEW_ONLY'], reason: 'The document does not follow the rules for its type, or its type is not the one selected.' },
  { category: 'EXPIRED_DOCUMENT', codes: ['DOCUMENT_EXPIRED'], reason: 'A document has expired.' },
  { category: 'INCONSISTENT_IDENTITY', codes: ['NAME_MISMATCH', 'DOB_MISMATCH', 'GENDER_MISMATCH', 'PAN_SURNAME_INITIAL_MISMATCH', 'PARENT_NAME_MISMATCH'], reason: 'Identity details disagree between documents or with the profile.' },
  { category: 'SUSPICIOUS_PHOTO', codes: ['ELEMENT_MISSING', 'DOCUMENT_FACE_NOT_FOUND', 'DOCUMENT_FACE_POOR', 'SCREENSHOT_OR_SCREEN_CAPTURE'], reason: 'The document photo or another expected element is missing, unclear, or a screen capture.' },
  { category: 'DUPLICATE_DOCUMENT', codes: ['DUPLICATE_DOCUMENT_OTHER_ACCOUNT'], reason: 'The same document is linked to another account.' },
  { category: 'FACE_MISMATCH', codes: ['FACE_NO_MATCH'], reason: 'The live face does not match the document photograph.' },
  { category: 'POSSIBLE_IMPERSONATION', codes: ['ENROLLED_NO_MATCH'], reason: 'The person in front of the camera is not the enrolled account holder.' },
  { category: 'LIVENESS_FAILED', codes: ['PAD_SPOOF', 'PAD_UNKNOWN'], reason: 'The live capture did not pass liveness (spoof suspected, or not enough evidence).' },
  { category: 'MISSING_OR_UNREADABLE', codes: ['MISSING_FIELD', 'TEXT_UNREADABLE', 'FILE_UNREADABLE', 'FILE_LOCKED', 'LOW_RESOLUTION', 'IMAGE_BLURRY'], reason: 'Information is missing or could not be read.' },
];

export function assessRisks(findings: Finding[]): RiskIndicator[] {
  const out: RiskIndicator[] = [];
  for (const rule of RISK_MAP) {
    const hits = findings.filter((f) => rule.codes.includes(f.code) && f.severity !== 'INFO');
    if (!hits.length) continue;
    out.push({ category: rule.category, severity: worst(hits)!, reason: rule.reason, sourceCodes: Array.from(new Set(hits.map((h) => h.code))) });
  }
  return out;
}

// ── Decision ─────────────────────────────────────────────────────────────────

export function decide(input: {
  reports: DocumentReport[];
  risks: RiskIndicator[];
  documentChecks: StageStatus;
  corroboration: { ok: boolean; by: string };
  recognisedCount: number;
}): { status: VerificationStatus; reasons: string[]; codes: FindingCode[] } {
  const { risks, documentChecks, corroboration, recognisedCount } = input;
  const reasons: string[] = [];
  const codes = (sev: Severity[]) => Array.from(new Set(risks.filter((r) => sev.includes(r.severity)).flatMap((r) => r.sourceCodes)));

  const critical = risks.filter((r) => r.severity === 'CRITICAL');
  if (critical.length) {
    for (const r of critical) reasons.push(`Not accepted: ${r.reason}`);
    return { status: 'REJECTED', reasons, codes: codes(['CRITICAL']) };
  }
  if (!recognisedCount) {
    reasons.push('Not enough information: no supported identity document could be read.');
    return { status: 'INSUFFICIENT_EVIDENCE', reasons, codes: codes(['HIGH', 'MEDIUM', 'LOW']) };
  }
  const reviewRisks = risks.filter((r) => r.severity === 'HIGH' || r.severity === 'MEDIUM');
  if (reviewRisks.length || documentChecks === 'FAIL') {
    for (const r of reviewRisks) reasons.push(`Needs review: ${r.reason}`);
    if (!reviewRisks.length) reasons.push('Needs review: a document failed validation.');
    return { status: 'REVIEW_REQUIRED', reasons, codes: codes(['HIGH', 'MEDIUM']) };
  }
  if (!corroboration.ok) {
    reasons.push(documentChecks === 'PASS'
      ? 'Not enough information: the document passed its checks, but one document alone cannot establish identity. Add a second ID proof, or match your face to the document photo.'
      : 'Not enough information: the document could not be fully checked, and nothing else corroborates the identity.');
    return { status: 'INSUFFICIENT_EVIDENCE', reasons, codes: ['IDENTITY_NOT_CORROBORATED'] };
  }
  const low = risks.filter((r) => r.severity === 'LOW').length;
  reasons.push(`Checks passed: documents validated, no risk indicator that needs review${low ? ` (${low} low-severity indicator${low === 1 ? '' : 's'} noted)` : ''}, and identity corroborated by ${corroboration.by}.`);
  reasons.push('This is not a government verification; no issuer database was consulted.');
  return { status: 'CHECKS_PASSED', reasons, codes: ['IDENTITY_CORROBORATED'] };
}

/** Which stages produced the decision: every non-PASS stage that ran, plus the passing evidence when it passed. */
function basisFor(stages: StageResult[], status: VerificationStatus): DecisionBasis[] {
  const relevant = stages.filter((s) => s.stage !== 'IDENTITY_CLAIM' && s.stage !== 'RISK_ASSESSMENT'
    && (status === 'CHECKS_PASSED' ? s.status === 'PASS' : s.status === 'FAIL' || s.status === 'UNKNOWN'));
  return relevant
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage))
    .map((s) => ({
      stage: s.stage,
      status: s.status,
      codes: Array.from(new Set(s.findings.filter((f) => (status === 'CHECKS_PASSED' ? true : f.severity !== 'INFO')).map((f) => f.code))),
    }));
}
