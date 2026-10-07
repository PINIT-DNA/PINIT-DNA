/**
 * "What we checked" — the owner's latest identity-verification run.
 * Keeps the document checks apart from the identity decision, lists what was
 * read (numbers masked by the server) and every stage with PASS / FAIL /
 * NOT RUN / UNKNOWN and its evidence. Owner-only.
 */
import { useEffect, useState } from 'react';
import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, CircleX, Plus } from 'lucide-react';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';

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

  if (!loaded || !v || !Array.isArray(v.stages)) return null;
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
