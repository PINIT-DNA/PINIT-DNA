/**
 * PINIT-DNA — Certificate Verification Portal (Phase 4.5)
 * Route: /verify-certificate
 *
 * Verifies a certificate by checking DNA Record + Vault record against the live DB.
 * DOES NOT modify any existing logic.
 */

import { useState } from 'react';
import {
  Shield, CheckCircle2, XCircle, AlertTriangle,
  Dna, Lock, Award, RefreshCw, Copy, Ban,
} from 'lucide-react';
import { verifyCertificateApi } from '../services/dashboard.api';
import type { CertVerificationResult } from '../types/dashboard.types';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { getDnaRecord, getVaultRecord } from '../services/dashboard.api';
import { Badge } from '../components/ui/Badge';
import { cn } from '../components/ui/utils';
import { formatBytes } from '../hooks/useApi';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────

type VerificationStatus = 'VALID' | 'INVALID' | 'PARTIAL' | 'NOT_FOUND';

interface VerificationResult {
  status: VerificationStatus;
  dnaRecord: Record<string, unknown> | null;
  vaultRecord: Record<string, unknown> | null;
  checks: { label: string; passed: boolean; detail: string }[];
  verifiedAt: string;
}

// ─── Verification logic ───────────────────────────────────────────────────────

async function verifyInputs(
  dnaRecordId: string,
  vaultId: string
): Promise<VerificationResult> {
  const checks: VerificationResult['checks'] = [];
  let dnaRecord = null;
  let vaultRecord = null;

  // Check DNA record
  try {
    const res = await getDnaRecord(dnaRecordId.trim());
    dnaRecord = res;
    checks.push({
      label: 'DNA Record Exists',
      passed: true,
      detail: `Record found with status: ${res.status}`,
    });
    checks.push({
      label: 'DNA Generation Complete',
      passed: res.status === 'COMPLETE',
      detail: res.status === 'COMPLETE'
        ? '10 fingerprint layers successfully generated'
        : `Status is ${res.status} — not fully complete`,
    });
  } catch {
    checks.push({ label: 'DNA Record Exists', passed: false, detail: 'DNA Record ID not found in database' });
    checks.push({ label: 'DNA Generation Complete', passed: false, detail: 'Cannot verify — record not found' });
  }

  // Check vault record
  if (vaultId.trim()) {
    try {
      const res = await getVaultRecord(vaultId.trim());
      vaultRecord = res;
      checks.push({
        label: 'Vault Record Exists',
        passed: true,
        detail: `Vault record found — ${res.encryptionAlgorithm}`,
      });
      checks.push({
        label: 'DNA-Vault Link Valid',
        passed: res.dnaRecordId === dnaRecordId.trim(),
        detail: res.dnaRecordId === dnaRecordId.trim()
          ? 'Vault record correctly linked to this DNA record'
          : `Vault links to different DNA record: ${res.dnaRecordId?.slice(0, 12)}…`,
      });
      checks.push({
        label: 'Encryption Standard',
        passed: res.encryptionAlgorithm === 'AES-256-GCM',
        detail: `Algorithm: ${res.encryptionAlgorithm} · Key: ${res.keyDerivation}`,
      });
    } catch {
      checks.push({ label: 'Vault Record Exists', passed: false, detail: 'Vault ID not found in database' });
      checks.push({ label: 'DNA-Vault Link Valid', passed: false, detail: 'Cannot verify — vault not found' });
      checks.push({ label: 'Encryption Standard', passed: false, detail: 'Cannot verify — vault not found' });
    }
  }

  // Determine overall status
  const passed = checks.filter(c => c.passed).length;
  const total  = checks.length;
  const status: VerificationStatus =
    passed === total ? 'VALID'
    : passed === 0   ? 'NOT_FOUND'
    : passed >= total / 2 ? 'PARTIAL'
    : 'INVALID';

  return { status, dnaRecord, vaultRecord, checks, verifiedAt: new Date().toISOString() };
}

// ─── Status display ───────────────────────────────────────────────────────────

const STATUS_CFG = {
  VALID:     { icon: <CheckCircle2 size={24} />, color: 'text-success', bg: 'bg-success/10 border-success/30',
               label: 'Certificate Valid',    sub: 'All checks passed — certificate is authentic' },
  PARTIAL:   { icon: <AlertTriangle size={24} />, color: 'text-warning', bg: 'bg-warning/10 border-warning/30',
               label: 'Partially Valid',      sub: 'Some checks passed — review failed checks below' },
  INVALID:   { icon: <XCircle size={24} />, color: 'text-danger', bg: 'bg-danger/10 border-danger/30',
               label: 'Certificate Invalid',  sub: 'Verification failed — this certificate cannot be confirmed' },
  NOT_FOUND: { icon: <XCircle size={24} />, color: 'text-gray-400', bg: 'bg-bg-elevated border-bg-border',
               label: 'Not Found',            sub: 'No records found for the provided IDs' },
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export function VerifyCertificatePage() {
  const [dnaId,    setDnaId]    = useState('');
  const [vaultId,  setVaultId]  = useState('');
  const [certId,   setCertId]   = useState('');  // direct certificate ID lookup
  const [loading,  setLoading]  = useState(false);
  const [result,   setResult]   = useState<VerificationResult | null>(null);
  const [certResult, setCertResult] = useState<CertVerificationResult | null>(null);

  const handleVerify = async () => {
    setLoading(true);
    setResult(null);
    setCertResult(null);

    // If certificate ID provided → use real backend verification
    if (certId.trim()) {
      try {
        const res = await verifyCertificateApi(certId.trim());
        setCertResult(res);
        if (res.valid) toast.success('Certificate verified — VALID');
        else if (res.status === 'REVOKED') toast.error('Certificate is REVOKED');
        else if (res.status === 'EXPIRED') toast.error('Certificate has EXPIRED');
        else toast.error('Certificate verification failed');
      } catch {
        toast.error('Verification error');
      } finally { setLoading(false); }
      return;
    }

    // Otherwise fall back to DNA Record + Vault ID check
    if (!dnaId.trim()) { toast.error('DNA Record ID or Certificate ID is required'); setLoading(false); return; }
    try {
      const res = await verifyInputs(dnaId, vaultId);
      setResult(res);
      if (res.status === 'VALID') toast.success('Certificate verified successfully');
      else if (res.status === 'PARTIAL') toast.error('Partial verification — some checks failed');
      else toast.error('Verification failed');
    } catch {
      toast.error('Verification error — check console');
    } finally {
      setLoading(false);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  };

  const statusCfg = result ? STATUS_CFG[result.status] : null;

  return (
    <div className="max-w-3xl mx-auto space-y-6 animate-fade-in">

      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-white">Certificate Verification Portal</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Verify the authenticity of any PINIT-DNA certificate in real time
        </p>
      </div>

      {/* Input form */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Shield size={18} className="text-dna-400" />
          <h2 className="text-sm font-semibold text-white">Enter Certificate Details</h2>
        </div>

        <div className="space-y-3">
          {/* Certificate ID — fastest lookup */}
          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">
              Certificate ID <span className="text-dna-400 text-xs">(recommended — direct lookup)</span>
            </label>
            <div className="relative">
              <Award size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="e.g. CERT-DNA-XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
                value={certId}
                onChange={e => { setCertId(e.target.value); if (e.target.value) { setDnaId(''); setVaultId(''); } }}
                className="input pl-9 font-mono text-sm"
              />
            </div>
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 h-px bg-bg-border" />
            <span className="text-2xs text-gray-600 uppercase tracking-wider">or verify by IDs</span>
            <div className="flex-1 h-px bg-bg-border" />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">
              DNA Record ID
            </label>
            <div className="relative">
              <Dna size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="e.g. 7ef2dc68-0cbc-4251-9a7c-dadb2dcdf3c5"
                value={dnaId}
                onChange={e => { setDnaId(e.target.value); if (e.target.value) setCertId(''); }}
                className="input pl-9 font-mono text-sm"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-400 block mb-1.5">
              Vault ID <span className="text-gray-600">(optional)</span>
            </label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                placeholder="e.g. c0ab8889-80f8-43ba-9736-f41cbd7a6b74"
                value={vaultId}
                onChange={e => setVaultId(e.target.value)}
                className="input pl-9 font-mono text-sm"
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleVerify}
          disabled={loading || (!dnaId.trim() && !certId.trim())}
          className="btn btn-primary w-full"
        >
          {loading
            ? <><RefreshCw size={15} className="animate-spin" /> Verifying…</>
            : <><Shield size={15} /> Verify Certificate</>}
        </button>

        {/* How to find IDs */}
        <div className="rounded-xl bg-bg-elevated border border-bg-border p-3">
          <p className="text-xs font-semibold text-gray-400 mb-2">Where to find these IDs:</p>
          <div className="space-y-1">
            {[
              { icon: <Dna size={11} className="text-dna-400" />, label: 'DNA Record ID', source: 'DNA Records page or Generate DNA result' },
              { icon: <Lock size={11} className="text-success" />, label: 'Vault ID', source: 'Vault Explorer page or Store in Vault result' },
              { icon: <Award size={11} className="text-purple" />, label: 'Certificate ID', source: 'Certificates page (prefixed CERT-DNA-)' },
            ].map(item => (
              <div key={item.label} className="flex items-center gap-2">
                {item.icon}
                <span className="text-2xs text-gray-500">
                  <span className="text-gray-300 font-medium">{item.label}</span> — {item.source}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Result */}
      {/* Certificate ID result — REVOKED/EXPIRED/VALID */}
      <AnimatePresence>
        {certResult && (
          <motion.div
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Status banner */}
            {certResult.status === 'REVOKED' ? (
              <div className="rounded-2xl border border-danger/40 bg-danger/10 p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-danger/20 border border-danger/30 flex items-center justify-center">
                    <Ban size={22} className="text-danger" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-danger">Certificate Revoked</p>
                    <p className="text-sm text-gray-400 mt-0.5">This certificate has been permanently revoked</p>
                  </div>
                </div>
                {certResult.certificate?.revokedAt && (
                  <div className="bg-danger/10 rounded-xl p-3 space-y-1.5">
                    <div className="flex gap-2">
                      <span className="text-2xs text-gray-500 w-28">Revoked At</span>
                      <span className="text-2xs text-danger mono">
                        {new Date(certResult.certificate.revokedAt).toLocaleString()}
                      </span>
                    </div>
                    {certResult.certificate.revocationReason && (
                      <div className="flex gap-2">
                        <span className="text-2xs text-gray-500 w-28">Reason</span>
                        <span className="text-2xs text-gray-300 italic">
                          &ldquo;{certResult.certificate.revocationReason}&rdquo;
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : certResult.status === 'EXPIRED' ? (
              <div className="rounded-2xl border border-warning/40 bg-warning/10 p-5">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-warning/20 border border-warning/30 flex items-center justify-center">
                    <AlertTriangle size={22} className="text-warning" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-warning">Certificate Expired</p>
                    <p className="text-sm text-gray-400 mt-0.5">
                      Expired {certResult.certificate?.expiresAt
                        ? new Date(certResult.certificate.expiresAt).toLocaleDateString()
                        : ''}
                    </p>
                  </div>
                </div>
              </div>
            ) : certResult.status === 'NOT_FOUND' ? (
              <div className="rounded-2xl border border-bg-border bg-bg-elevated p-5">
                <div className="flex items-center gap-4">
                  <XCircle size={22} className="text-gray-500" />
                  <div>
                    <p className="text-lg font-bold text-gray-300">Certificate Not Found</p>
                    <p className="text-sm text-gray-500">No certificate found with this ID in the registry</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-success/40 bg-success/10 p-5">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-success/20 border border-success/30 flex items-center justify-center">
                    <CheckCircle2 size={22} className="text-success" />
                  </div>
                  <div>
                    <p className="text-xl font-bold text-success">Certificate Valid</p>
                    <p className="text-sm text-gray-400 mt-0.5">Signature verified · Status ACTIVE</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Certificate ID', value: certResult.certificateId },
                    { label: 'Status',         value: certResult.status },
                    { label: 'Issued',         value: certResult.certificate?.issuedAt ? new Date(certResult.certificate.issuedAt).toLocaleDateString() : '—' },
                    { label: 'DNA Record',     value: certResult.certificate?.dnaRecordId?.slice(0, 16) + '…' },
                  ].map(row => (
                    <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
                      <p className="text-2xs text-gray-500">{row.label}</p>
                      <p className="text-xs text-gray-200 mono truncate mt-0.5">{row.value}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={() => { setCertResult(null); setCertId(''); setDnaId(''); setVaultId(''); }}
              className="btn btn-secondary w-full">
              <RefreshCw size={14} /> Verify Another
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {result && statusCfg && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="space-y-4"
          >
            {/* Status banner */}
            <div className={cn('rounded-2xl border p-5', statusCfg.bg)}>
              <div className="flex items-center gap-4">
                <div className={statusCfg.color}>{statusCfg.icon}</div>
                <div>
                  <p className={`text-lg font-bold ${statusCfg.color}`}>{statusCfg.label}</p>
                  <p className="text-sm text-gray-400 mt-0.5">{statusCfg.sub}</p>
                </div>
                <div className="ml-auto text-right">
                  <p className="text-2xs text-gray-500">Verified at</p>
                  <p className="text-xs text-gray-300 mono">{format(new Date(result.verifiedAt), 'PPpp')}</p>
                </div>
              </div>
            </div>

            {/* Verification checks */}
            <div className="card p-0 overflow-hidden">
              <div className="px-5 py-3 border-b border-bg-border">
                <p className="text-sm font-semibold text-white">Verification Checks</p>
              </div>
              <div className="divide-y divide-bg-border">
                {result.checks.map((check, i) => (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    {check.passed
                      ? <CheckCircle2 size={16} className="text-success shrink-0" />
                      : <XCircle size={16} className="text-danger shrink-0" />}
                    <div className="flex-1">
                      <p className="text-sm font-medium text-white">{check.label}</p>
                      <p className="text-xs text-gray-500">{check.detail}</p>
                    </div>
                    <Badge variant={check.passed ? 'success' : 'danger'}>
                      {check.passed ? 'PASS' : 'FAIL'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* DNA Record details */}
            {result.dnaRecord && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <Dna size={16} className="text-dna-400" />
                  <p className="text-sm font-semibold text-white">DNA Record Details</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Record ID',    value: (result.dnaRecord as Record<string, unknown>).id as string },
                    { label: 'Status',       value: (result.dnaRecord as Record<string, unknown>).status as string },
                    { label: 'File',         value: (result.dnaRecord as Record<string, unknown>).filename as string },
                    { label: 'Created',      value: result.dnaRecord.createdAt ? format(new Date(result.dnaRecord.createdAt as string), 'PPp') : '' },
                  ].map(row => (
                    <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
                      <p className="text-2xs text-gray-500">{row.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-gray-200 mono truncate">{String(row.value ?? '—')}</p>
                        {row.label === 'Record ID' && row.value && (
                          <button onClick={() => copy(row.value as string)} className="shrink-0">
                            <Copy size={10} className="text-gray-500 hover:text-white" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Vault Record details */}
            {result.vaultRecord && (
              <div className="card">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={16} className="text-success" />
                  <p className="text-sm font-semibold text-white">Vault Record Details</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Vault ID',         value: (result.vaultRecord as Record<string,unknown>).id as string },
                    { label: 'Encryption',        value: (result.vaultRecord as Record<string,unknown>).encryptionAlgorithm as string },
                    { label: 'Key Derivation',    value: (result.vaultRecord as Record<string,unknown>).keyDerivation as string },
                    { label: 'Encrypted Size',    value: formatBytes((result.vaultRecord as Record<string,unknown>).encryptedSizeBytes as number) },
                  ].map(row => (
                    <div key={row.label} className="bg-bg-elevated rounded-lg p-3">
                      <p className="text-2xs text-gray-500">{row.label}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <p className="text-xs text-gray-200 mono truncate">{String(row.value ?? '—')}</p>
                        {row.label === 'Vault ID' && row.value && (
                          <button onClick={() => copy(row.value as string)} className="shrink-0">
                            <Copy size={10} className="text-gray-500 hover:text-white" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Reset */}
            <button onClick={() => { setResult(null); setCertResult(null); setDnaId(''); setVaultId(''); setCertId(''); }}
              className="btn btn-secondary w-full">
              <RefreshCw size={14} /> Verify Another Certificate
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
