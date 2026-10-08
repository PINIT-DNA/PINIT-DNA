import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Camera, Car, Check, CreditCard, FileText, Landmark, Vote, IdCard, Lock, Plus, ShieldCheck, Upload, X } from 'lucide-react';
import { api, formatApiError } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { cameraErrorMessage, openCameraStream, preferContinuousFocus, preferNaturalExposure } from '../../lib/camera-stream';
import { IdentityChecks } from './IdentityChecks';
import { FaceRoundScan } from '../auth/FaceRoundScan';
import { documentFaceFromFile } from '../../lib/document-face';
import type { FacePadEvidence } from '../../lib/face-api-client';

type DocumentType = 'AADHAAR' | 'PAN' | 'PASSPORT' | 'DRIVERS_LICENSE' | 'VOTER_ID' | 'NATIONAL_ID';
type FaceBinding = 'MATCHED' | 'NOT_MATCHED' | 'REQUIRES_RECHECK';

interface GovernmentIdView {
  documentStatus: 'NOT_ADDED' | 'ON_FILE';
  documentType: DocumentType | null;
  sealedAt: string | null;
  faceBinding: FaceBinding | null;
  faceBindingCheckedAt: string | null;
  faceEnrolled: boolean;
  hasBackSide?: boolean;
}

/** Upload choice → identity-verification document type (null = let the content decide). */
const IDENTITY_TYPE: Record<DocumentType, string | null> = {
  AADHAAR: 'AADHAAR',
  PAN: 'PAN',
  PASSPORT: 'PASSPORT',
  DRIVERS_LICENSE: 'DRIVING_LICENCE',
  VOTER_ID: 'VOTER_ID',
  NATIONAL_ID: null,
};

const TYPE_LABEL: Record<DocumentType, string> = {
  AADHAAR: 'Aadhaar',
  PAN: 'PAN card',
  PASSPORT: 'Passport',
  DRIVERS_LICENSE: 'Driving licence',
  VOTER_ID: 'Voter ID',
  NATIONAL_ID: 'Other government ID',
};

function addedOn(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

type Step = 'idle' | 'choose' | 'capture' | 'preview' | 'camera' | 'analysis' | 'face' | 'result';
type CheckStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNKNOWN' | 'PENDING';

interface Finding { code: string; severity: string; message: string }
interface VerificationRun {
  status: 'CHECKS_PASSED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'INSUFFICIENT_EVIDENCE';
  reasons: string[];
  stages: Array<{ stage: string; status: Exclude<CheckStatus, 'PENDING'>; findings: Finding[] }>;
  documents?: Array<{
    origin?: string;
    detectedType?: string | null;
    fields?: Record<string, { value?: string; confidence?: number; status?: 'READ' | 'VALIDATED' | 'NEEDS_REVIEW' | 'INVALID' } | undefined>;
  }>;
  face?: { documentPhoto?: 'USABLE_FACE' | 'POOR_FACE' | 'NO_FACE' | 'NOT_PROVIDED' };
}

const RESULT_LABEL: Record<VerificationRun['status'], string> = {
  CHECKS_PASSED: 'Checks passed',
  REVIEW_REQUIRED: 'Needs review',
  REJECTED: 'Not accepted',
  INSUFFICIENT_EVIDENCE: 'Not enough information',
};

function stageOf(run: VerificationRun | null, name: string): CheckStatus {
  return run?.stages.find((s) => s.stage === name)?.status ?? 'PENDING';
}

type Side = 'front' | 'back';

/**
 * What the back of each document carries. null = nothing useful on the back,
 * so no back slot is shown. The back is always optional.
 */
const BACK_SIDE: Record<DocumentType, { label: string; hint: string } | null> = {
  AADHAAR: { label: 'Back side', hint: 'Has your address' },
  PAN: null,
  PASSPORT: { label: 'Last page', hint: 'Has your address and family details' },
  DRIVERS_LICENSE: { label: 'Back side', hint: 'Validity and vehicle classes, on most cards' },
  VOTER_ID: { label: 'Back side', hint: 'Has your address' },
  NATIONAL_ID: { label: 'Back side', hint: 'If it carries details' },
};

/** The privacy promise, stated the same way wherever the card appears. */
const PRIVACY_LINE = 'Encrypted and private. Only the Pinit team can access your document.';

export function GovernmentIdSettings({
  variant = 'security',
  onSaved,
}: {
  /** "profile" is the larger card on the Profile tab; "security" is the compact one. */
  variant?: 'profile' | 'security';
  /** Called after a proof is saved so the page can refresh its profile strength. */
  onSaved?: () => void;
} = {}) {
  const [view, setView] = useState<GovernmentIdView | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('idle');
  const [error, setError] = useState('');
  const [documentType, setDocumentType] = useState<DocumentType>('AADHAAR');
  const [saving, setSaving] = useState(false);
  const [checksKey, setChecksKey] = useState(0);
  const [clearing, setClearing] = useState(false);
  const [verification, setVerification] = useState<VerificationRun | null>(null);
  const [activeSide, setActiveSide] = useState<Side>('front');
  const liveRef = useRef<{ embedding: number[]; padEvidence?: FacePadEvidence } | null>(null);
  /** save = add or replace the proof on file; second = check another ID against it. */
  const [purpose, setPurpose] = useState<'save' | 'second'>('save');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
  const [frontRead, setFrontRead] = useState(false);
  const [cameraSide, setCameraSide] = useState<Side>('front');
  const frontInputRef = useRef<HTMLInputElement | null>(null);
  const backInputRef = useRef<HTMLInputElement | null>(null);

  const load = () => {
    setLoading(true);
    api.get(`${API_BASE_URL}/profile/government-id`)
      .then((r) => {
        setView((r.data as { governmentId?: GovernmentIdView }).governmentId ?? null);
        setLoading(false);
      })
      .catch((err) => {
        setError(formatApiError(err));
        setLoading(false);
      });
  };

  useEffect(() => { load(); }, []);

  const resetSides = () => {
    setFront(null);
    setBack(null);
    setFrontRead(false);
    if (frontInputRef.current) frontInputRef.current.value = '';
    if (backInputRef.current) backInputRef.current.value = '';
  };

  const setSide = (side: Side, file: File | null | undefined) => {
    setError('');
    if (side === 'front') setFront(file ?? null);
    else setBack(file ?? null);
  };

  /**
   * Saves the proof (purpose "save"), or checks it against the saved proof
   * (purpose "second": analysed only, not stored, does not replace the saved proof).
   * Front is required; back is optional and checked together with the front.
   */
  const submit = async () => {
    if (!front) {
      setError('Add the front side first.');
      return;
    }
    setSaving(true);
    setError('');
    setVerification(null);
    setStep('analysis');
    try {
      const body = new FormData();
      // Face on the document photo, found on this device. Only its numbers are
      // sent. A PDF is not examined, and the server reports that honestly.
      const face = await documentFaceFromFile(front);
      const withBack = back && BACK_SIDE[documentType] ? back : null;
      if (purpose === 'second') {
        body.append('documents', front);
        if (withBack) body.append('documentBack', withBack);
        body.append('documentTypes', JSON.stringify([IDENTITY_TYPE[documentType]]));
        if (face !== undefined) body.append('documentFaces', JSON.stringify([face]));
        body.append('includeSavedProof', 'true');
        const r = await api.post(`${API_BASE_URL}/profile/identity-verification/analyze`, body);
        const data = r.data as { success?: boolean; error?: string };
        if (!data.success) {
          setError(data.error || 'This document could not be checked.');
          return;
        }
      } else {
        body.append('document', front);
        if (withBack) body.append('documentBack', withBack);
        body.append('documentType', documentType);
        if (face !== undefined) body.append('documentFace', JSON.stringify(face));
        const r = await api.post(`${API_BASE_URL}/profile/government-id`, body);
        const data = r.data as { success?: boolean; error?: string; governmentId?: GovernmentIdView };
        if (!data.governmentId) {
          setError(data.error || 'This document was not saved.');
          return;
        }
        setView(data.governmentId);
        onSaved?.();
      }
      const latest = await api.get(`${API_BASE_URL}/profile/identity-verification/latest`);
      const run = (latest.data as { verification?: VerificationRun | null }).verification ?? null;
      if (!run?.stages) {
        setError('The document was received, but the check result could not be read.');
        return;
      }
      const rejected = currentRejection(run, documentType, Boolean(BACK_SIDE[documentType]));
      if (rejected) {
        setError(rejected);
        const redoBack = rejected.includes('address') && Boolean(BACK_SIDE[documentType]);
        setActiveSide(redoBack ? 'back' : 'front');
        if (redoBack) setBack(null);
        else setFront(null);
        setStep('capture');
        return;
      }
      setVerification(run);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const proofLine = view?.documentType
    ? `${TYPE_LABEL[view.documentType]}${view.hasBackSide ? ' · Front and back' : ''}${view.sealedAt ? ` · Added ${addedOn(view.sealedAt)}` : ''}`
    : '';

  const onFile = view?.documentStatus === 'ON_FILE';
  const closeFlow = () => {
    setStep('idle');
    setPurpose('save');
    setError('');
    setActiveSide('front');
    setVerification(null);
    liveRef.current = null;
    resetSides();
  };

  /** Reads one side without saving it. A side is kept only when this says it is current. */
  const readSide = async (file: File): Promise<VerificationRun> => {
    const body = new FormData();
    const face = await documentFaceFromFile(file);
    body.append('documents', file);
    body.append('documentTypes', JSON.stringify([IDENTITY_TYPE[documentType]]));
    if (face !== undefined) body.append('documentFaces', JSON.stringify([face]));
    const r = await api.post(`${API_BASE_URL}/profile/identity-verification/analyze`, body);
    const data = r.data as { success?: boolean; error?: string; verification?: VerificationRun };
    if (!data.verification?.stages) {
      throw new Error(data.error || 'This ID could not be read.');
    }
    return data.verification;
  };

  const acceptPreview = async () => {
    const file = activeSide === 'front' ? front : back;
    if (!file) return;
    if (activeSide === 'back') {
      await submit();
      return;
    }
    if (activeSide === 'front' && frontRead && verification) {
      if (BACK_SIDE[documentType]) {
        setActiveSide('back');
        setStep('capture');
        return;
      }
      await submit();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const run = await readSide(file);
      const reason = currentRejection(run, documentType, false);
      if (reason) {
        setError(reason);
        setFront(null);
        setFrontRead(false);
        if (frontInputRef.current) frontInputRef.current.value = '';
        setActiveSide('front');
        setStep('capture');
        return;
      }
      setVerification(run);
      setFrontRead(true);
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const retake = () => {
    setError('');
    if (activeSide === 'front') setFrontRead(false);
    setSide(activeSide, null);
    if (activeSide === 'front' && frontInputRef.current) frontInputRef.current.value = '';
    if (activeSide === 'back' && backInputRef.current) backInputRef.current.value = '';
    setStep('capture');
  };

  const submitLive = async () => {
    if (!front || !liveRef.current) {
      setError('Take a live selfie first.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const body = new FormData();
      const face = await documentFaceFromFile(front);
      const withBack = back && BACK_SIDE[documentType] ? back : null;
      body.append('documents', front);
      if (withBack) body.append('documentBack', withBack);
      body.append('documentTypes', JSON.stringify([IDENTITY_TYPE[documentType]]));
      if (face !== undefined) body.append('documentFaces', JSON.stringify([face]));
      body.append('live', JSON.stringify(liveRef.current));
      if (purpose === 'second') body.append('includeSavedProof', 'true');
      const r = await api.post(`${API_BASE_URL}/profile/identity-verification/analyze`, body);
      const data = r.data as { success?: boolean; error?: string; verification?: VerificationRun };
      if (!data.success || !data.verification?.stages) {
        setError(data.error || 'The live photo could not be checked.');
        return;
      }
      setVerification(data.verification);
      setChecksKey((k) => k + 1);
      setStep('result');
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const clearProof = async () => {
    setClearing(true);
    setError('');
    try {
      const r = await api.delete(`${API_BASE_URL}/profile/government-id`);
      setView((r.data as { governmentId?: GovernmentIdView }).governmentId ?? null);
      setChecksKey((k) => k + 1);
      onSaved?.();
    } catch (err) {
      setError(formatApiError(err));
    } finally {
      setClearing(false);
    }
  };

  const startAdd = () => { setError(''); setActiveSide('front'); setVerification(null); liveRef.current = null; resetSides(); setPurpose('save'); setStep('choose'); };
  const startSecondProof = () => { setError(''); setActiveSide('front'); setVerification(null); liveRef.current = null; resetSides(); setPurpose('second'); setStep('choose'); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2">
          {variant === 'profile'
            ? <><ShieldCheck size={15} className="text-dna-600 dark:text-dna-400" /> Identity verification</>
            : <><IdCard size={15} className="text-dna-600 dark:text-dna-400" /> Identity Proof</>}
        </h2>
        <span className="flex-1" />
        {view && (onFile
          ? <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">On file</span>
          : <span className="text-2xs font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">Not added</span>)}
      </div>

      {loading && !view ? <p className="text-sm text-slate-500">Loading…</p> : null}

      {variant === 'profile' && view && step === 'idle' && !onFile && (
        <div className="flex gap-4 items-start">
          <div className="w-12 h-12 rounded-xl bg-dna-50 dark:bg-dna-500/10 text-dna-600 dark:text-dna-400 flex items-center justify-center shrink-0">
            <IdCard size={22} />
          </div>
          <div className="flex-1 min-w-0 space-y-3">
            <p className="text-sm text-slate-600 dark:text-gray-300">
              Keep an identity proof linked to your Pinit account for backup and recovery.
            </p>
            <ol className="flex flex-wrap gap-2">
              {['Choose document', 'Scan or upload'].map((label, i) => (
                <li key={label} className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-gray-300 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-bg-border bg-slate-50 dark:bg-bg-elevated">
                  <span className="w-5 h-5 rounded-full bg-dna-100 dark:bg-dna-500/20 text-dna-700 dark:text-dna-400 text-2xs font-bold flex items-center justify-center">{i + 1}</span>
                  {label}
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-4 flex-wrap">
              <button type="button" className="btn btn-primary btn-sm text-xs" onClick={startAdd}>
                <Plus size={13} /> Verify your identity
              </button>
              <span className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
                <Lock size={12} /> {PRIVACY_LINE}
              </span>
            </div>
          </div>
        </div>
      )}

      {variant === 'profile' && view && step === 'idle' && onFile && (
        <div className="flex gap-4 items-start">
          <div className="w-12 h-12 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
            <BadgeCheck size={22} />
          </div>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-slate-900 dark:text-white">{proofLine}</p>
            <p className="text-xs text-slate-500 dark:text-gray-400">
              Shown as <b className="text-slate-700 dark:text-gray-200">ID on file</b> next to your name, visible only to you.
              It never appears on shared links or your public page.
            </p>
            <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
              <Lock size={12} /> {PRIVACY_LINE}
            </p>
            <div className="flex gap-4 pt-1">
              <button type="button" className="text-sm font-medium text-dna-600 dark:text-dna-400" onClick={startAdd}>
                Replace
              </button>
              <button type="button" disabled={clearing} className="text-sm font-medium text-slate-500 dark:text-gray-400" onClick={() => void clearProof()}>
                {clearing ? 'Clearing…' : 'Clear'}
              </button>
            </div>
            <IdentityChecks refreshKey={checksKey} onAddSecondProof={startSecondProof} />
          </div>
        </div>
      )}

      {variant === 'security' && view && step === 'idle' && view.documentStatus === 'NOT_ADDED' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-600 dark:text-gray-300">
            Keep an identity proof linked to your Pinit account for backup and recovery.
          </p>
          <p className="text-sm text-slate-900 dark:text-white">Not added</p>
          <button
            type="button"
            className="text-sm font-medium text-dna-600 dark:text-dna-400"
            onClick={startAdd}
          >
            + Add Identity Proof
          </button>
        </div>
      )}

      {variant === 'security' && view && step === 'idle' && view.documentStatus === 'ON_FILE' && (
        <div className="space-y-2">
          <p className="text-sm text-slate-700 dark:text-gray-300">{proofLine}</p>
          <div className="flex gap-4">
            <button
              type="button"
              className="text-sm font-medium text-dna-600 dark:text-dna-400"
              onClick={startAdd}
            >
              Replace
            </button>
          </div>
        </div>
      )}

      {variant === 'security' && view && step === 'idle' && (
        <p className="inline-flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
          <Lock size={12} /> {PRIVACY_LINE}
        </p>
      )}

      {error && step === 'idle' && (
        <p className="text-sm text-amber-700 dark:text-amber-200">{error}</p>
      )}

      {step !== 'idle' && (
        <IdentityDialog
          title={dialogTitle(step, activeSide)}
          steps={flowStepsFor(documentType)}
          stepIndex={flowIndexFor(step, activeSide, Boolean(BACK_SIDE[documentType]))}
          onClose={closeFlow}
        >
          {step === 'choose' && (
            <div className="space-y-4">
              <p className="text-sm text-slate-700 dark:text-gray-200">Which document will you add?</p>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Document type">
                {DOCUMENT_OPTIONS.map(({ type, hint, icon }) => {
                  const on = documentType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => setDocumentType(type)}
                      className={`flex items-center gap-3 w-full text-left px-3.5 py-3 rounded-xl border transition-colors ${
                        on
                          ? 'border-dna-500 bg-dna-50/70 dark:bg-dna-500/10'
                          : 'border-slate-200 dark:border-white/10 hover:border-slate-300 dark:hover:border-white/20'
                      }`}
                    >
                      <span className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                        on ? 'bg-dna-500 text-white' : 'bg-slate-100 dark:bg-white/10 text-slate-600 dark:text-gray-300'
                      }`}
                      >
                        {icon}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-semibold text-slate-900 dark:text-white">{TYPE_LABEL[type]}</span>
                        <span className="block text-2xs text-slate-500 dark:text-gray-400">{hint}</span>
                      </span>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${
                        on ? 'border-dna-500 bg-dna-500 ring-2 ring-inset ring-white dark:ring-[#171A21]' : 'border-slate-300 dark:border-gray-600'
                      }`}
                      />
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm text-xs justify-center w-full"
                onClick={() => {
                  setError('');
                  setActiveSide('front');
                  if (!BACK_SIDE[documentType]) setBack(null);
                  setStep('capture');
                }}
              >
                Scan or upload your ID
              </button>
            </div>
          )}

          {step === 'capture' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-xs justify-center"
                  onClick={() => { setError(''); setCameraSide(activeSide); setStep('camera'); }}
                >
                  <Camera size={14} /> Scan
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm text-xs justify-center"
                  onClick={() => (activeSide === 'front' ? frontInputRef : backInputRef).current?.click()}
                >
                  <Upload size={14} /> Upload
                </button>
              </div>
              <input
                ref={frontInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setSide('front', file);
                  setStep('preview');
                }}
              />
              <input
                ref={backInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  setSide('back', file);
                  setStep('preview');
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm text-xs justify-center w-full"
                onClick={() => {
                  setError('');
                  if (activeSide === 'back') { setActiveSide('front'); setStep('preview'); return; }
                  setStep('choose');
                }}
              >
                Back
              </button>
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-3">
              <IdPreview file={activeSide === 'front' ? front : back} />
              {activeSide === 'front' && frontRead && verification && (
                <FieldReadout run={verification} type={documentType} />
              )}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={saving} className="btn btn-secondary btn-sm text-xs justify-center" onClick={retake}>
                  Try again
                </button>
                <button type="button" disabled={saving || !(activeSide === 'front' ? front : back)} className="btn btn-primary btn-sm text-xs justify-center" onClick={() => void acceptPreview()}>
                  {saving ? 'Checking…' : 'Continue'}
                </button>
              </div>
            </div>
          )}

          {step === 'camera' && (
            <IdCameraCapture
              key={cameraSide}
              label={cameraSide === 'front' ? 'Front side' : BACK_SIDE[documentType]?.label ?? 'Back side'}
              busy={saving}
              onCancel={() => setStep('capture')}
              onCapture={(file) => { setSide(cameraSide, file); setStep('preview'); }}
            />
          )}

          {step === 'analysis' && (
            <div className="space-y-3">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Document analysis</p>
              {verification && <FieldReadout run={verification} type={documentType} />}
              {saving && <p className="text-xs text-slate-500">Reading and checking…</p>}
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={saving} className="btn btn-secondary btn-sm text-xs justify-center" onClick={() => setStep('preview')}>
                  Back
                </button>
                <button
                  type="button"
                  disabled={saving || !verification || currentRejection(verification, documentType, Boolean(BACK_SIDE[documentType])) !== null}
                  className="btn btn-primary btn-sm text-xs justify-center"
                  onClick={() => { setError(''); setStep('face'); }}
                >
                  Continue
                </button>
              </div>
            </div>
          )}

          {step === 'face' && (
            <div className="space-y-3">
              <div className="idv-face pinit-auth">
                <FaceRoundScan
                  mode="login"
                  title="Take a live selfie"
                  samplesRequired={1}
                  identityError={error}
                  onEmbedding={(embedding) => { liveRef.current = { embedding, padEvidence: liveRef.current?.padEvidence }; }}
                  onPadEvidence={(padEvidence) => {
                    if (liveRef.current) liveRef.current = { ...liveRef.current, padEvidence };
                  }}
                  onNext={() => { void submitLive(); }}
                  onError={setError}
                />
              </div>
              {saving && <p className="text-xs text-slate-500">Checking the live photo…</p>}
            </div>
          )}

          {step === 'result' && verification && (
            <div className="space-y-4">
              <FieldReadout run={verification} type={documentType} />
              <p className="text-sm font-semibold text-slate-900 dark:text-white">Face verification</p>
              <CheckList items={faceLines(verification)} />
              <div className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-5 text-center">
                <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Identity result</p>
                {identityVerified(verification) ? (
                  <p className="mt-2 text-base font-semibold text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
                    Identity Verified <Check size={16} />
                  </p>
                ) : (
                  <p className="mt-2 text-base font-semibold text-slate-900 dark:text-white">{RESULT_LABEL[verification.status]}</p>
                )}
                {verification.reasons[0] && (
                  <p className="mt-2 text-xs text-slate-600 dark:text-gray-300">{verification.reasons[0]}</p>
                )}
              </div>
              <button type="button" className="btn btn-primary btn-sm text-xs justify-center w-full" onClick={closeFlow}>
                Done
              </button>
            </div>
          )}

          {error && step !== 'face' && (
            <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-200">{error}</p>
          )}
        </IdentityDialog>
      )}
    </div>
  );
}

function flowStepsFor(type: DocumentType): string[] {
  return BACK_SIDE[type]
    ? ['Document', 'Front side', 'Back side', 'Identity result']
    : ['Document', 'Front side', 'Identity result'];
}

function flowIndexFor(step: Exclude<Step, 'idle'>, side: Side, hasBack: boolean): number {
  if (step === 'choose') return 0;
  if (step === 'capture' || step === 'preview' || step === 'camera') return side === 'back' && hasBack ? 2 : 1;
  return hasBack ? 3 : 2;
}

function dialogTitle(step: Exclude<Step, 'idle'>, side: Side): string {
  if (step === 'choose') return 'Government ID';
  if (step === 'capture' || step === 'camera') return side === 'front' ? 'Front side' : 'Back side';
  if (step === 'preview') return side === 'front' ? 'Front side preview' : 'Back side preview';
  if (step === 'analysis') return 'Document analysis';
  if (step === 'face') return 'Face verification';
  return 'Identity result';
}

function fieldPresent(fields: Record<string, { value?: string } | undefined>, key: string): boolean {
  if (key === 'dateOfBirth') {
    const dob = fields.dateOfBirth?.value?.trim();
    const year = fields.yearOfBirth?.value?.trim();
    return Boolean(dob || year);
  }
  const value = fields[key]?.value?.trim() ?? '';
  return value.length >= 2;
}

function activeDocument(run: VerificationRun) {
  return (run.documents ?? []).find((d) => d.origin !== 'SAVED_PROOF') ?? run.documents?.[0];
}

/** Fields the OCR actually produced. The issuer line is filled in by the adapter, so it does not count as a read. */
function realFields(run: VerificationRun): Array<[string, { value?: string }]> {
  const fields = activeDocument(run)?.fields ?? {};
  return Object.entries(fields).filter((entry): entry is [string, { value?: string }] => {
    const [key, field] = entry;
    return key !== 'issuingAuthority' && (field?.value?.trim().length ?? 0) >= 2;
  });
}

/**
 * A clearer photo is asked for only when OCR extracted no document fields.
 * A partial read (for example the date, but not the name) is shown and left for review.
 */
function unreadDetails(run: VerificationRun): string | null {
  if (realFields(run).length > 0) return null;
  return 'This photo is not clear enough to read the document. Scan or upload a clearer image.';
}

function currentRejection(run: VerificationRun, type?: DocumentType, _includeAddress = false): string | null {
  const findings = run.stages.flatMap((s) => s.findings);
  const mismatch = findings.find((f) => f.code === 'TYPE_MISMATCH');
  if (mismatch) return mismatch.message;
  const duplicate = findings.find((f) => f.code === 'DUPLICATE_DOCUMENT_OTHER_ACCOUNT');
  if (duplicate) return duplicate.message;
  if (findings.some((f) => f.code === 'DOCUMENT_EXPIRED')) return 'This ID has expired.';
  if (findings.some((f) => f.code === 'DATE_INVALID' || f.code === 'DATE_ORDER_INVALID')) return 'The date on this ID is not valid.';
  if (!type || realFields(run).length > 0) return null;
  const unclear = findings.find((f) => f.message === 'Document image is unclear. Please capture the ID again.');
  if (unclear) return unclear.message;
  const unread = findings.find((f) => f.code === 'TEXT_UNREADABLE' || f.code === 'FILE_UNREADABLE');
  if (unread) return unread.message;
  return unreadDetails(run);
}

const READOUT_ROWS: Array<{ key: string; label: string }> = [
  { key: 'fullName', label: 'Name' },
  { key: 'documentNumber', label: 'ID number' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
];

function FieldReadout({ run, type }: { run: VerificationRun; type: DocumentType }) {
  const fields = activeDocument(run)?.fields ?? {};
  const detected = activeDocument(run)?.detectedType;
  const rows = READOUT_ROWS.filter((row) => row.key === 'fullName' || row.key === 'documentNumber' || fieldPresent(fields, row.key) || (row.key === 'dateOfBirth' && type !== 'VOTER_ID'));
  const photo = run.face?.documentPhoto;
  return (
    <div className="rounded-xl border border-slate-200 dark:border-white/10 px-3 py-2 space-y-2">
      {detected && <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500">Document detected: {detected.replace(/_/g, ' ')}</p>}
      {rows.map((row) => {
        const field = row.key === 'dateOfBirth'
          ? (fields.dateOfBirth ?? fields.yearOfBirth)
          : fields[row.key];
        const value = field?.value?.trim() ?? '';
        const present = value.length >= 2;
        const status = !present
          ? 'Needs review'
          : field?.status === 'VALIDATED'
            ? 'Validated'
            : field?.status === 'NEEDS_REVIEW' || field?.status === 'INVALID'
              ? 'Needs review'
              : 'Read';
        const ok = status === 'Read' || status === 'Validated';
        return (
          <div key={row.key}>
            <p className="text-2xs text-slate-500">{row.key === 'documentNumber' && type === 'AADHAAR' ? 'Aadhaar number' : row.label}</p>
            <p className="text-sm text-slate-900 dark:text-white">{present ? value : '—'}</p>
            <p className={`text-2xs ${ok ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}`}>
              {status}
            </p>
          </div>
        );
      })}
      <p className="text-2xs text-slate-500">Photo {photo === 'USABLE_FACE' || photo === 'POOR_FACE' ? '· Detected' : photo === 'NO_FACE' ? '· Not detected' : '· Not checked yet'}</p>
    </div>
  );
}

function faceLines(run: VerificationRun | null): Array<{ label: string; status: CheckStatus }> {
  const liveness = stageOf(run, 'PAD_LIVENESS');
  return [
    { label: 'Face detected', status: liveness === 'PENDING' || liveness === 'NOT_RUN' ? liveness : 'PASS' },
    { label: 'Liveness passed', status: liveness },
    { label: 'ID photo matched', status: stageOf(run, 'DOCUMENT_PHOTO_VS_LIVE_FACE') },
  ];
}

function identityVerified(run: VerificationRun): boolean {
  return run.status === 'CHECKS_PASSED' && currentRejection(run) === null;
}

function CheckList({ items }: { items: Array<{ label: string; status: CheckStatus }> }) {
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2 text-sm text-slate-800 dark:text-gray-200">
          {item.status === 'PASS' && <Check size={15} className="text-emerald-600 dark:text-emerald-400 shrink-0" />}
          {item.status === 'FAIL' && <X size={15} className="text-red-600 dark:text-red-400 shrink-0" />}
          {(item.status === 'PENDING' || item.status === 'NOT_RUN' || item.status === 'UNKNOWN') && (
            <span className="w-3.5 h-3.5 rounded-full border border-slate-300 dark:border-gray-600 shrink-0" />
          )}
          <span>{item.label}</span>
          {item.status === 'NOT_RUN' && <span className="text-2xs text-slate-400">Not run</span>}
          {item.status === 'UNKNOWN' && <span className="text-2xs text-amber-700 dark:text-amber-300">Not confirmed</span>}
          {item.status === 'FAIL' && <span className="text-2xs text-red-700 dark:text-red-300">Did not pass</span>}
        </li>
      ))}
    </ul>
  );
}

/** Large preview of the side just scanned or uploaded. */
function IdPreview({ file }: { file: File | null }) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  if (!file) return <p className="text-sm text-slate-500">No image to preview.</p>;
  if (!preview) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-white/10 px-4 py-8 text-center">
        <FileText size={28} className="mx-auto text-slate-400" />
        <p className="mt-2 text-sm text-slate-700 dark:text-gray-200">{file.name}</p>
      </div>
    );
  }
  return (
    <img src={preview} alt="ID preview" className="w-full max-h-72 object-contain rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/20" />
  );
}

const DOCUMENT_OPTIONS: { type: DocumentType; hint: string; icon: React.ReactNode }[] = [
  { type: 'AADHAAR', hint: 'Front side, or the back for address', icon: <IdCard size={17} /> },
  { type: 'PAN', hint: 'Front side with your photo', icon: <CreditCard size={17} /> },
  { type: 'PASSPORT', hint: 'The page with your photo', icon: <FileText size={17} /> },
  { type: 'DRIVERS_LICENSE', hint: 'Front side with your photo', icon: <Car size={17} /> },
  { type: 'VOTER_ID', hint: 'Front side with your photo', icon: <Vote size={17} /> },
  { type: 'NATIONAL_ID', hint: 'Any other officially issued ID', icon: <Landmark size={17} /> },
];

/**
 * A small centred dialog for the identity flow. It is drawn on <body> so
 * nothing on the Profile or Security tab (like the sticky strength panel)
 * can cover it, and the page behind it does not scroll.
 */
function IdentityDialog({
  title,
  steps,
  stepIndex,
  onClose,
  children,
}: {
  title: string;
  steps: string[];
  /** 0-based step of the add flow. */
  stepIndex: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current(); };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-[2px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="idv-title"
        className="w-full max-w-[520px] max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white dark:bg-[#171A21] border border-slate-200 dark:border-white/10 shadow-2xl"
      >
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-slate-100 dark:border-white/10">
          <span className="w-9 h-9 rounded-xl bg-dna-50 dark:bg-dna-500/15 text-dna-600 dark:text-dna-400 flex items-center justify-center shrink-0">
            <ShieldCheck size={18} />
          </span>
          <div className="flex-1 min-w-0">
            <p id="idv-title" className="text-sm font-semibold text-slate-900 dark:text-white">{title}</p>
            <p className="text-2xs text-slate-500 dark:text-gray-400">
              {`Step ${stepIndex + 1} of ${steps.length} · ${steps[stepIndex] ?? ''}`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="p-1.5 -mr-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 dark:hover:text-white dark:hover:bg-white/10"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex gap-1.5 px-5 pt-3" aria-hidden="true">
          {steps.map((label, i) => (
            <span key={label} className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-dna-500' : 'bg-slate-200 dark:bg-white/10'}`} />
          ))}
        </div>
        <div className="px-5 py-4">{children}</div>
        <p className="flex items-center gap-1.5 px-5 py-3 border-t border-slate-100 dark:border-white/10 text-2xs text-slate-500 dark:text-gray-400">
          <Lock size={12} className="shrink-0" /> {PRIVACY_LINE}
        </p>
      </div>
    </div>,
    document.body,
  );
}

function IdCameraCapture({
  label,
  busy,
  onCapture,
  onCancel,
}: {
  label: string;
  busy: boolean;
  onCapture: (file: File) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [cameraError, setCameraError] = useState('');

  useEffect(() => {
    let stopped = false;
    void openCameraStream({ facingMode: 'environment', detail: true })
      .then(async (stream) => {
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const track = stream.getVideoTracks()[0];
        await preferContinuousFocus(track);
        await preferNaturalExposure(track);
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
        setReady(true);
      })
      .catch((err) => setCameraError(cameraErrorMessage(err, 'Allow the camera to scan the ID.')));
    return () => {
      stopped = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const capture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError('The camera is still starting. Wait a second and capture again.');
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) {
        setCameraError('The ID photo could not be captured.');
        return;
      }
      onCapture(new File([blob], `${label.toLowerCase().replace(/\s+/g, '-')}.jpg`, { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="space-y-3">
      <div className="relative rounded-xl overflow-hidden bg-black aspect-[4/3]">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-contain" />
        <div className="absolute inset-3 rounded-lg border border-white/70 pointer-events-none" />
        <p className="absolute bottom-2 inset-x-0 text-center text-2xs font-medium text-white" style={{ color: '#ffffff' }}>
          {ready ? `${label}` : 'Starting camera…'}
        </p>
      </div>
      {cameraError && <p className="text-sm text-amber-700 dark:text-amber-300">{cameraError}</p>}
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="btn btn-secondary btn-sm text-xs justify-center">
          Back
        </button>
        <button type="button" disabled={!ready || busy} onClick={capture} className="btn btn-primary btn-sm text-xs justify-center">
          <Camera size={14} /> {busy ? 'Saving…' : 'Capture'}
        </button>
      </div>
    </div>
  );
}
