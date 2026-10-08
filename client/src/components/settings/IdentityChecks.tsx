/**
 * "What we checked" — the owner's latest identity-verification run.
 * Keeps the document checks apart from the identity decision, lists what was
 * read (numbers masked by the server) and every stage with PASS / FAIL /
 * NOT RUN / UNKNOWN and its evidence. Owner-only.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, CircleX, Eye, EyeOff, Plus, ShieldCheck } from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { notifyProfileUpdated } from '../../hooks/useUserProfile';

type Status = 'CHECKS_PASSED' | 'REVIEW_REQUIRED' | 'REJECTED' | 'INSUFFICIENT_EVIDENCE';
type StageStatus = 'PASS' | 'FAIL' | 'NOT_RUN' | 'UNKNOWN';
type Severity = 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

interface Finding { code: string; severity: Severity; message: string }
interface Field { value: string; confidence: number; source: string }
interface Verification {
  createdAt: string;
  status: Status;
  documentChecks?: StageStatus;
  identityCorroborated?: boolean;
  reasons: string[];
  documents: Array<{
    index: number;
    origin?: 'SUBMITTED' | 'SAVED_PROOF';
    detectedType: string | null;
    fields: Record<string, Field>;
    elements?: Partial<Record<'PHOTOGRAPH' | 'SIGNATURE' | 'MRZ', { status: 'PRESENT' | 'MISSING' | 'NOT_CHECKED'; evidence: string }>>;
  }>;
  stages: Array<{ stage: string; status: StageStatus; summary: string; evidence?: string[]; findings: Finding[] }>;
}

const DECISION: Record<Status, { label: string; cls: string }> = {
  CHECKS_PASSED: { label: 'Checks passed', cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  REVIEW_REQUIRED: { label: 'Needs review', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' },
  REJECTED: { label: 'Not accepted', cls: 'bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-300' },
  INSUFFICIENT_EVIDENCE: { label: 'Not enough information', cls: 'bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-gray-300' },
};

const STAGE_STATUS: Record<StageStatus, { label: string; cls: string }> = {
  PASS: { label: 'Pass', cls: 'text-emerald-700 dark:text-emerald-300' },
  FAIL: { label: 'Fail', cls: 'text-red-700 dark:text-red-300' },
  UNKNOWN: { label: 'Unknown', cls: 'text-amber-700 dark:text-amber-300' },
  NOT_RUN: { label: 'Not run', cls: 'text-slate-500 dark:text-gray-400' },
};

const TYPE: Record<string, string> = {
  PASSPORT: 'Passport', AADHAAR: 'Aadhaar', PAN: 'PAN card', DRIVING_LICENCE: 'Driving licence',
  VOTER_ID: 'Voter ID', GOVERNMENT_ID: 'Government ID',
};

const FIELD: Record<string, string> = {
  fullName: 'Name', fatherOrGuardianName: "Father's / guardian's name", motherName: "Mother's name",
  dateOfBirth: 'Date of birth', yearOfBirth: 'Year of birth', gender: 'Gender', documentNumber: 'Number',
  virtualId: 'Virtual ID', nationality: 'Nationality', address: 'Address', issueDate: 'Issued',
  expiryDate: 'Valid until', issuingAuthority: 'Issued by', issuingCountry: 'Issuing country',
  placeOfBirth: 'Place of birth', vehicleClasses: 'Vehicle classes', electoralConstituency: 'Assembly constituency',
  electoralPartNumber: 'Part number',
};

const STAGE: Record<string, string> = {
  IDENTITY_CLAIM: 'Identity claim', DOCUMENT_IDENTIFICATION: 'Document identification',
  INFORMATION_EXTRACTED: 'Information extracted', DOCUMENT_VALIDATED: 'Document validated',
  DOCUMENT_AUTHENTICITY_SIGNALS: 'Document authenticity signals', CROSS_ID_CONSISTENCY: 'Cross-ID consistency',
  DOCUMENT_PHOTO_VS_LIVE_FACE: 'Document photo ↔ live face', PAD_LIVENESS: 'PAD / liveness',
  LIVE_FACE_VS_ENROLLED: 'Live face ↔ enrolled PINIT identity', RISK_ASSESSMENT: 'Risk assessment',
  VERIFICATION_DECISION: 'Final verification decision', AUDIT_RECORD: 'Audit record',
};

const ELEMENT: Record<string, string> = { PHOTOGRAPH: 'Photograph', SIGNATURE: 'Signature', MRZ: 'MRZ' };

function showValue(key: string, value: string): string {
  if ((key === 'dateOfBirth' || key === 'issueDate' || key === 'expiryDate') && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (key === 'gender') return ({ M: 'Male', F: 'Female', X: 'Other' } as Record<string, string>)[value] ?? value.charAt(0) + value.slice(1).toLowerCase();
  return value;
}

function StatusIcon({ status }: { status: StageStatus }) {
  if (status === 'PASS') return <CircleCheck size={14} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-px" />;
  if (status === 'FAIL') return <CircleX size={14} className="text-red-600 dark:text-red-400 shrink-0 mt-px" />;
  if (status === 'UNKNOWN') return <CircleAlert size={14} className="text-amber-600 dark:text-amber-400 shrink-0 mt-px" />;
  return <CircleMinus size={14} className="text-slate-400 shrink-0 mt-px" />;
}

/** Problems first, then the strongest passing checks. */
function headlineFindings(v: Verification): Finding[] {
  const all = v.stages.flatMap((s) => s.findings);
  const good = all.filter((f) => f.severity === 'INFO'
    && ['CHECKSUM_VALID', 'NUMBER_STRUCTURE_VALID', 'TYPE_RECOGNISED', 'DOCUMENT_NOT_EXPIRED', 'NAME_MATCH', 'NAME_EXPECTED_VARIATION', 'IDENTITY_CORROBORATED', 'FACE_MATCH'].includes(f.code));
  const bad = all.filter((f) => f.severity !== 'INFO');
  const seen = new Set<string>();
  return [...bad, ...good].filter((f) => (seen.has(f.message) ? false : (seen.add(f.message), true))).slice(0, 6);
}

interface VerifiedDetails {
  documentType: string | null;
  verifiedAt: string;
  revealed: boolean;
  addressEditedByOwner?: boolean;
  fullName: string | null;
  documentNumber: string | null;
  dateOfBirth: string | null;
  gender: string | null;
  address: string | null;
}

/**
 * Once every check has passed, the profile shows only the status. The details
 * read from the ID are kept encrypted and are shown here, to the owner only,
 * when asked for. Sensitive values stay masked until the owner chooses to show them.
 */
function VerifiedSummary({ v }: { v: Verification }) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [details, setDetails] = useState<VerifiedDetails | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'missing'>('idle');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  async function saveAddress() {
    setSaving(true);
    setSaveError('');
    try {
      await api.patch(`${API_BASE_URL}/profile/government-id/details`, { address: draft });
      setEditing(false);
      setReloadKey((k) => k + 1);
    } catch (err) {
      const message = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setSaveError(message || 'Could not save the address. Try again.');
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setState('loading');
    api.get(`${API_BASE_URL}/profile/government-id/details${reveal ? '?reveal=1' : ''}`)
      .then((r) => {
        if (!alive) return;
        const d = (r.data as { details?: VerifiedDetails | null }).details ?? null;
        setDetails(d);
        setState(d ? 'idle' : 'missing');
      })
      .catch(() => { if (alive) setState('missing'); });
    return () => { alive = false; };
  }, [open, reveal, reloadKey]);

  const rows: Array<[string, string | null | undefined]> = details
    ? [['Name', details.fullName], ['Number', details.documentNumber], ['Date of birth', details.dateOfBirth ? showValue('dateOfBirth', details.dateOfBirth) : null], ['Gender', details.gender ? showValue('gender', details.gender) : null], ['Address', details.address]]
    : [];

  return (
    <div className="mt-3 rounded-xl border border-emerald-200/70 dark:border-emerald-500/25 bg-emerald-50/60 dark:bg-emerald-500/5 p-3.5">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300"><ShieldCheck size={17} /></span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Identity verified</p>
          <p className="text-2xs text-slate-500 dark:text-gray-400">{new Date(v.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · all checks passed</p>
        </div>
        <span className="flex-1" />
        <button type="button" onClick={() => { setOpen((o) => !o); if (open) setReveal(false); }} aria-expanded={open}
          className="inline-flex items-center gap-1 text-xs font-medium text-dna-600 dark:text-dna-400">
          <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} /> {open ? 'Hide details' : 'My verified details'}
        </button>
      </div>
      {open && (
        <div className="mt-3 border-t border-emerald-200/60 dark:border-emerald-500/20 pt-3">
          {state === 'loading' && !details && <p className="text-xs text-slate-500">Loading…</p>}
          {state === 'missing' && <p className="text-xs text-slate-500 dark:text-gray-400">Your details will appear here after your next identity check.</p>}
          {details && (
            <>
              <dl className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                {rows.filter(([, val]) => val).map(([k, val]) => (
                  <div key={k} className="contents">
                    <dt className="text-slate-500 dark:text-gray-400">{k}</dt>
                    <dd className="text-slate-900 dark:text-gray-100 break-words tabular-nums">{val}</dd>
                  </div>
                ))}
              </dl>
              {reveal && details.address && (
                <div className="mt-2.5">
                  {!editing ? (
                    <button type="button" onClick={() => { setDraft(details.address ?? ''); setSaveError(''); setEditing(true); }}
                      className="inline-flex items-center gap-1 text-xs font-medium text-dna-600 dark:text-dna-400">
                      Address wrong or incomplete? Edit it
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <label className="block text-2xs font-medium text-slate-600 dark:text-gray-300" htmlFor="verified-address">Address as printed on your ID</label>
                      <textarea id="verified-address" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={400}
                        className="w-full rounded-lg border border-slate-300 dark:border-white/15 bg-white dark:bg-white/5 px-2.5 py-2 text-xs text-slate-900 dark:text-gray-100" />
                      {saveError && <p className="text-2xs text-red-600 dark:text-red-400">{saveError}</p>}
                      <div className="flex gap-2">
                        <button type="button" disabled={saving} onClick={saveAddress} className="btn btn-primary btn-sm text-xs">{saving ? 'Saving…' : 'Save address'}</button>
                        <button type="button" disabled={saving} onClick={() => setEditing(false)} className="btn btn-sm text-xs">Cancel</button>
                      </div>
                    </div>
                  )}
                  {details.addressEditedByOwner && !editing && <p className="mt-1 text-2xs text-slate-400 dark:text-gray-500">You corrected this address.</p>}
                </div>
              )}
              <button type="button" onClick={() => setReveal((r) => !r)} className="mt-2.5 inline-flex items-center gap-1 text-xs font-medium text-slate-600 dark:text-gray-300">
                {reveal ? <><EyeOff size={13} /> Hide sensitive details</> : <><Eye size={13} /> Show sensitive details</>}
              </button>
              <p className="mt-2 text-2xs text-slate-400 dark:text-gray-500">Only you can see this. It is stored encrypted and is never shown on shared links or your public page.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function IdentityChecks({ refreshKey = 0, onAddSecondProof }: { refreshKey?: number; onAddSecondProof?: () => void }) {
  const [v, setV] = useState<Verification | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    api.get(`${API_BASE_URL}/profile/identity-verification/latest`)
      .then((r) => {
        if (alive) setV((r.data as { verification?: Verification | null }).verification ?? null);
      })
      .catch(() => { if (alive) setV(null); })
      .then(() => { if (alive) setLoaded(true); });
    return () => { alive = false; };
  }, [refreshKey]);

  // The account name is filled from the ID once the checks pass, so refresh the profile once.
  const passed = loaded && v?.status === 'CHECKS_PASSED';
  useEffect(() => { if (passed) notifyProfileUpdated(); }, [passed]);

  if (!loaded || !v || !Array.isArray(v.stages)) return null;
  if (v.status === 'CHECKS_PASSED') return <VerifiedSummary v={v} />;
  const decision = DECISION[v.status];
  const docChecks = v.documentChecks ? STAGE_STATUS[v.documentChecks] : null;
  const needsCorroboration = v.status === 'INSUFFICIENT_EVIDENCE' && v.documentChecks === 'PASS' && !v.identityCorroborated;

  return (
    <div className="mt-3 rounded-xl border border-slate-200 dark:border-white/10 p-3.5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-xs font-semibold text-slate-900 dark:text-white">What we checked</p>
        <span className="flex-1" />
        <span className="text-2xs text-slate-400">{new Date(v.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2">
          <p className="text-2xs text-slate-500 dark:text-gray-400">Document checks</p>
          <p className={`text-xs font-semibold ${docChecks?.cls ?? 'text-slate-500'}`}>{docChecks?.label ?? '—'}</p>
        </div>
        <div className="rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2">
          <p className="text-2xs text-slate-500 dark:text-gray-400">Identity verification</p>
          <span className={`inline-block mt-0.5 text-2xs font-semibold px-2 py-0.5 rounded-full ${decision.cls}`}>{decision.label}</span>
        </div>
      </div>

      {v.reasons[0] && <p className="text-xs text-slate-700 dark:text-gray-300">{v.reasons[0]}</p>}

      {needsCorroboration && onAddSecondProof && (
        <button type="button" onClick={onAddSecondProof} className="btn btn-primary btn-sm text-xs">
          <Plus size={13} /> Add a second ID proof
        </button>
      )}

      {v.documents.filter((d) => d.detectedType && Object.keys(d.fields).length).map((d) => (
        <div key={`${d.origin}-${d.index}`}>
          <p className="text-2xs font-semibold uppercase tracking-wider text-slate-500 dark:text-gray-400 mb-1.5">
            Read from your {TYPE[d.detectedType ?? ''] ?? 'document'}{d.origin === 'SAVED_PROOF' ? ' (saved proof)' : ''}
          </p>
          <dl className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
            {Object.keys(FIELD).filter((k) => d.fields[k]).map((k) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 dark:text-gray-400">{FIELD[k]}</dt>
                <dd className="text-slate-900 dark:text-gray-100 break-words tabular-nums">{showValue(k, d.fields[k]!.value)}</dd>
              </div>
            ))}
            {Object.entries(d.elements ?? {}).map(([k, e]) => (
              <div key={k} className="contents">
                <dt className="text-slate-500 dark:text-gray-400">{ELEMENT[k] ?? k}</dt>
                <dd className={`${e!.status === 'PRESENT' ? 'text-emerald-700 dark:text-emerald-300' : e!.status === 'MISSING' ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500 dark:text-gray-400'}`}>
                  {e!.status === 'PRESENT' ? 'Present' : e!.status === 'MISSING' ? 'Not found' : 'Not checked'}
                  <span className="text-slate-400 dark:text-gray-500"> · {e!.evidence}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ))}

      <ul className="space-y-1">
        {headlineFindings(v).map((f) => (
          <li key={f.message} className="flex items-start gap-2 text-xs text-slate-700 dark:text-gray-300">
            <StatusIcon status={f.severity === 'INFO' ? 'PASS' : f.severity === 'HIGH' || f.severity === 'CRITICAL' ? 'FAIL' : 'UNKNOWN'} />
            <span>{f.message}</span>
          </li>
        ))}
      </ul>

      <details className="group">
        <summary className="list-none cursor-pointer inline-flex items-center gap-1 text-xs font-medium text-dna-600 dark:text-dna-400">
          <ChevronDown size={13} className="transition-transform group-open:rotate-180" /> All {v.stages.length} checks
        </summary>
        <ol className="mt-2 space-y-2">
          {v.stages.map((s) => (
            <li key={s.stage} className="flex items-start gap-2 text-xs">
              <StatusIcon status={s.status} />
              <span className="min-w-0">
                <span className="font-medium text-slate-800 dark:text-gray-200">{STAGE[s.stage] ?? s.stage}</span>
                <span className={`ml-1.5 text-2xs font-semibold ${STAGE_STATUS[s.status]?.cls ?? ''}`}>{STAGE_STATUS[s.status]?.label ?? s.status}</span>
                <span className="block text-slate-500 dark:text-gray-400">{s.summary}</span>
                {s.evidence && s.evidence.length > 0 && (
                  <span className="block text-2xs text-slate-400 dark:text-gray-500">{s.evidence.join(' · ')}</span>
                )}
              </span>
            </li>
          ))}
        </ol>
      </details>

      <p className="text-2xs text-slate-400 dark:text-gray-500">
        Automatic checks. Reading a document is not verification, and a valid number is not proof that a document is genuine.
        No government database is consulted.
      </p>
    </div>
  );
}
