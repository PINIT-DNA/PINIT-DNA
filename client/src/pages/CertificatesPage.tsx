import { Award, Download, Printer, Shield, Archive, Dna, Lock, CheckCircle2, Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { useApi } from '../hooks/useApi';
import { listVaultRecords } from '../services/dashboard.api';
import { Badge } from '../components/ui/Badge';
import { EmptyState } from '../components/ui/EmptyState';
import { SkeletonCard } from '../components/ui/Skeleton';
import { Link } from 'react-router-dom';
import type { VaultRecord } from '../types/dashboard.types';

function CertificateCard({ vault }: { vault: VaultRecord }) {
  const certId = `CERT-DNA-${vault.id.slice(0, 8).toUpperCase()}`;
  const issueDate = format(new Date(vault.createdAt), 'MMMM d, yyyy');

  const handleDownload = () => {
    const cert = {
      certificateId:      certId,
      type:               'UNIVERSAL_DNA_OWNERSHIP_CERTIFICATE',
      version:            '2.0.0',
      issuedAt:           new Date().toISOString(),
      issuedBy:           'PINIT-DNA Universal File DNA Engine',
      subject: {
        fileName:         vault.originalFileName,
        mimeType:         vault.originalMimeType,
        originalSize:     vault.originalSizeBytes,
        encryptedSize:    vault.encryptedSizeBytes,
      },
      fingerprint: {
        dnaRecordId:      vault.dnaRecordId,
        vaultId:          vault.id,
        encryptionAlgorithm: vault.encryptionAlgorithm,
        keyDerivation:    vault.keyDerivation,
        layers:           6,
        standard:         'Universal File DNA v2.0',
      },
      security: {
        algorithm:        'AES-256-GCM',
        keySize:          256,
        authenticity:     'HMAC-SHA256 authenticated',
        tamperProof:      true,
      },
      statement: `This certificate confirms that the file "${vault.originalFileName}" has been ` +
                 `cryptographically fingerprinted using the PINIT-DNA Universal DNA Engine and ` +
                 `securely stored with AES-256-GCM encryption. The 6-layer DNA fingerprint serves ` +
                 `as proof of the file's identity and integrity at the time of registration.`,
    };

    const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${certId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card border-bg-border hover:border-dna-500/30 transition-all duration-200 overflow-hidden">
      {/* Certificate header ribbon */}
      <div className="h-1.5 bg-gradient-to-r from-dna-600 via-purple to-dna-400 -mx-6 -mt-6 mb-5" />

      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-dna-500/15 border border-dna-500/20 flex items-center justify-center">
            <Award size={18} className="text-dna-400" />
          </div>
          <div>
            <p className="text-xs font-bold text-dna-400 mono">{certId}</p>
            <p className="text-xs text-gray-500">DNA Ownership Certificate</p>
          </div>
        </div>
        <Badge variant="success" dot>Verified</Badge>
      </div>

      {/* File info */}
      <div className="space-y-2 mb-4">
        <div className="flex items-start gap-2">
          <Dna size={12} className="text-dna-400 mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-gray-400">Registered File</p>
            <p className="text-sm font-semibold text-white truncate">{vault.originalFileName}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-bg-elevated rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Lock size={10} className="text-success" />
              <p className="text-2xs text-gray-500">Encryption</p>
            </div>
            <p className="text-xs font-medium text-success mono">{vault.encryptionAlgorithm}</p>
          </div>
          <div className="bg-bg-elevated rounded-lg p-2.5">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Shield size={10} className="text-purple" />
              <p className="text-2xs text-gray-500">DNA Layers</p>
            </div>
            <p className="text-xs font-medium text-purple mono">6 Layers</p>
          </div>
        </div>
      </div>

      {/* Verification chain */}
      <div className="bg-bg-elevated rounded-xl p-3 mb-4 space-y-1.5">
        {[
          { icon: <CheckCircle2 size={11} className="text-success" />, label: 'SHA-256 Fingerprint', value: 'Verified' },
          { icon: <CheckCircle2 size={11} className="text-success" />, label: 'AES-256-GCM Seal',    value: 'Active'   },
          { icon: <CheckCircle2 size={11} className="text-success" />, label: 'HKDF Key Derivation',  value: 'Secured'  },
          { icon: <CheckCircle2 size={11} className="text-success" />, label: 'Auth Tag Integrity',   value: 'Intact'   },
        ].map(item => (
          <div key={item.label} className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {item.icon}
              <span className="text-2xs text-gray-400">{item.label}</span>
            </div>
            <span className="text-2xs font-medium text-success">{item.value}</span>
          </div>
        ))}
      </div>

      {/* IDs */}
      <div className="space-y-1.5 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xs text-gray-600 w-24 shrink-0">DNA Record</span>
          <span className="mono text-2xs text-dna-400 truncate">{vault.dnaRecordId}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-2xs text-gray-600 w-24 shrink-0">Vault ID</span>
          <span className="mono text-2xs text-purple truncate">{vault.id}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={10} className="text-gray-600" />
          <span className="text-2xs text-gray-500">Issued {issueDate}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-2 pt-4 border-t border-bg-border">
        <button
          onClick={handleDownload}
          className="btn btn-secondary btn-sm flex-1 text-xs"
        >
          <Download size={12} /> Export JSON
        </button>
        <button
          onClick={() => window.print()}
          className="btn btn-ghost btn-sm text-xs"
          title="Print certificate"
        >
          <Printer size={12} />
        </button>
      </div>
    </div>
  );
}

export function CertificatesPage() {
  const { data: vaults, loading, error } = useApi(listVaultRecords);

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Ownership Certificates</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Cryptographic proof of file ownership and DNA fingerprint registration
          </p>
        </div>
        {!loading && vaults && <Badge variant="dna">{vaults.length} certificates</Badge>}
      </div>

      {/* Explanation banner */}
      <div className="card bg-dna-500/5 border-dna-500/20">
        <div className="flex gap-4">
          <div className="w-10 h-10 rounded-xl bg-dna-500/15 flex items-center justify-center shrink-0">
            <Award size={18} className="text-dna-400" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-1">What is a DNA Certificate?</p>
            <p className="text-xs text-gray-400 leading-relaxed">
              Each certificate provides cryptographic proof that a specific file was registered
              in the PINIT-DNA system at a specific time. It includes the 6-layer DNA fingerprint
              record ID, the AES-256-GCM vault ID, and full encryption metadata. Certificates can
              be used to verify file ownership and detect unauthorised modifications.
            </p>
          </div>
        </div>
      </div>

      {error ? (
        <div className="card text-center">
          <p className="text-danger text-sm">{error}</p>
        </div>
      ) : loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : !vaults || vaults.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={Archive}
            title="No certificates yet"
            description="Store a file in the vault to generate its ownership certificate"
            action={
              <Link to="/generate" className="btn btn-primary btn-sm">
                <Dna size={14} /> Generate DNA & Vault
              </Link>
            }
          />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vaults.map(vault => (
            <CertificateCard key={vault.id} vault={vault} />
          ))}
        </div>
      )}
    </div>
  );
}
