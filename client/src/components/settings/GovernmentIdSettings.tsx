import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BadgeCheck, Camera, Car, Check, CreditCard, FileText, Landmark, Vote, IdCard, Lock, Plus, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { api, formatApiError } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { cameraErrorMessage, openCameraStream } from '../../lib/camera-stream';
import { IdentityChecks } from './IdentityChecks';
import { documentFaceFromFile } from '../../lib/document-face';

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

type Step = 'idle' | 'choose' | 'sides' | 'camera';
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

const FRONT_SIDE: Record<DocumentType, string> = {
  AADHAAR: 'Front side, with your photo and number',
  PAN: 'Front side, with your photo and PAN',
  PASSPORT: 'The page with your photo',
  DRIVERS_LICENSE: 'Front side, with your photo',
  VOTER_ID: 'Front side, with your photo',
  NATIONAL_ID: 'Front side, with your photo',
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
  /** save = add or replace the proof on file; second = check another ID against it. */
  const [purpose, setPurpose] = useState<'save' | 'second'>('save');
  const [front, setFront] = useState<File | null>(null);
  const [back, setBack] = useState<File | null>(null);
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
      setChecksKey((k) => k + 1);
      setStep('idle');
      setPurpose('save');
      resetSides();
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
    resetSides();
  };
  const startAdd = () => { setError(''); resetSides(); setPurpose('save'); setStep('choose'); };
  const startSecondProof = () => { setError(''); resetSides(); setPurpose('second'); setStep('choose'); };

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
                <Plus size={13} /> Add Identity Proof
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
          title={purpose === 'second' ? 'Add a second ID proof' : view?.documentStatus === 'ON_FILE' ? 'Replace identity proof' : 'Add identity proof'}
          stepIndex={step === 'choose' ? 0 : 1}
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
                  if (!BACK_SIDE[documentType]) setBack(null);
                  setStep('sides');
                }}
              >
                Continue
              </button>
            </div>
          )}

          {step === 'sides' && (
            <div className="space-y-3">
              <p className="text-sm text-slate-700 dark:text-gray-200">
                Add your {TYPE_LABEL[documentType]}. Scan it with your camera or upload a photo, screenshot or PDF.
              </p>
              <SideSlot
                title="Front side"
                hint={FRONT_SIDE[documentType]}
                required
                file={front}
                disabled={saving}
                onScan={() => { setError(''); setCameraSide('front'); setStep('camera'); }}
                onUpload={() => frontInputRef.current?.click()}
                onRemove={() => { setSide('front', null); if (frontInputRef.current) frontInputRef.current.value = ''; }}
              />
              {BACK_SIDE[documentType] ? (
                <SideSlot
                  title={BACK_SIDE[documentType]!.label}
                  hint={BACK_SIDE[documentType]!.hint}
                  file={back}
                  disabled={saving}
                  onScan={() => { setError(''); setCameraSide('back'); setStep('camera'); }}
                  onUpload={() => backInputRef.current?.click()}
                  onRemove={() => { setSide('back', null); if (backInputRef.current) backInputRef.current.value = ''; }}
                />
              ) : (
                <p className="text-2xs text-slate-500 dark:text-gray-400">A PAN card has nothing to add on the back, so only the front is needed.</p>
              )}
              <input
                ref={frontInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                disabled={saving}
                className="hidden"
                onChange={(e) => setSide('front', e.target.files?.[0])}
              />
              <input
                ref={backInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf,.jpg,.jpeg,.png,.webp,.pdf"
                disabled={saving}
                className="hidden"
                onChange={(e) => setSide('back', e.target.files?.[0])}
              />
              <p className="text-2xs text-slate-500 dark:text-gray-400">
                JPG, PNG, WEBP or PDF, up to 8 MB per side. Make sure every corner is visible and the text is readable.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" disabled={saving} className="btn btn-secondary btn-sm text-xs justify-center" onClick={() => setStep('choose')}>
                  Back
                </button>
                <button type="button" disabled={saving || !front} className="btn btn-primary btn-sm text-xs justify-center" onClick={() => void submit()}>
                  {saving ? 'Reading and checking…' : purpose === 'second' ? 'Check this ID' : 'Save ID proof'}
                </button>
              </div>
            </div>
          )}

          {step === 'camera' && (
            <IdCameraCapture
              key={cameraSide}
              label={cameraSide === 'front' ? 'Front side' : BACK_SIDE[documentType]?.label ?? 'Back side'}
              busy={saving}
              onCancel={() => setStep('sides')}
              onCapture={(file) => { setSide(cameraSide, file); setStep('sides'); }}
            />
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm text-amber-700 dark:text-amber-200">{error}</p>
          )}
        </IdentityDialog>
      )}
    </div>
  );
}

const FLOW_STEPS = ['Choose document', 'Front and back'] as const;

/** One side of the document: Scan or Upload, then a preview with Change / Remove. */
function SideSlot({
  title, hint, required, file, disabled, onScan, onUpload, onRemove,
}: {
  title: string; hint: string; required?: boolean; file: File | null; disabled?: boolean;
  onScan: () => void; onUpload: () => void; onRemove: () => void;
}) {
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  return (
    <div className={`rounded-xl border px-3.5 py-3 ${file ? 'border-emerald-300 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-white/10'}`}>
      <div className="flex items-start gap-3">
        <div className="w-16 h-11 rounded-md overflow-hidden bg-slate-100 dark:bg-white/10 flex items-center justify-center shrink-0">
          {preview
            ? <img src={preview} alt="" className="w-full h-full object-cover" />
            : file ? <FileText size={18} className="text-slate-500" /> : <IdCard size={18} className="text-slate-400" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
            {title}
            <span className={`text-2xs font-semibold ${required ? 'text-amber-700 dark:text-amber-300' : 'text-slate-400 dark:text-gray-500'}`}>
              {required ? 'Required' : 'Optional'}
            </span>
            {file && <Check size={14} className="text-emerald-600 dark:text-emerald-400" />}
          </p>
          <p className="text-2xs text-slate-500 dark:text-gray-400 truncate">{file ? file.name : hint}</p>
        </div>
      </div>
      <div className="flex gap-2 mt-2.5">
        <button type="button" disabled={disabled} onClick={onScan} className="btn btn-secondary btn-sm text-xs flex-1 justify-center">
          <Camera size={13} /> {file ? 'Rescan' : 'Scan'}
        </button>
        <button type="button" disabled={disabled} onClick={onUpload} className="btn btn-secondary btn-sm text-xs flex-1 justify-center">
          <Upload size={13} /> {file ? 'Change' : 'Upload'}
        </button>
        {file && (
          <button type="button" disabled={disabled} onClick={onRemove} aria-label={`Remove ${title.toLowerCase()}`} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-500/10">
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
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
  stepIndex,
  onClose,
  children,
}: {
  title: string;
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
              {`Step ${stepIndex + 1} of ${FLOW_STEPS.length} · ${FLOW_STEPS[stepIndex]}`}
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
          {FLOW_STEPS.map((label, i) => (
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
    void openCameraStream({ facingMode: 'environment' })
      .then((stream) => {
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
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
      <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-[4/3]">
        <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover" />
        {/* Document frame; the dimmed surround shows where to place the card. */}
        <div className="absolute inset-x-[7%] inset-y-[14%] rounded-lg border-2 border-white/85 shadow-[0_0_0_9999px_rgba(15,23,42,0.35)] pointer-events-none" />
        <p className="absolute bottom-2 inset-x-0 text-center text-2xs font-medium text-white">
          {ready ? `${label}: fit the whole side inside the frame` : 'Starting camera…'}
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
