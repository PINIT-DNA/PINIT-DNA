import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Fingerprint, ShieldCheck, ScanFace } from 'lucide-react';
import { LightDataTable } from '../components/LightDataTable';
import { LightStatusBadge } from '../components/LightStatusBadge';
import { LightStatCard } from '../components/LightStatCard';
import { fetchBiometricIdentities } from '../api/super-admin.api';
import type { BiometricIdentityRow, BiometricTemplateInfo } from '../api/super-admin.api';

function ModalityChip({ label, info }: { label: string; info: BiometricTemplateInfo }) {
  if (!info) {
    return <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-400 border border-gray-200">{label}</span>;
  }
  return (
    <span title={`${info.algorithm} — enrolled ${format(new Date(info.createdAt), 'MMM d, yyyy')}`} className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      {label}
    </span>
  );
}

export function BiometricIdentityPage() {
  const [data, setData] = useState<{ identities: BiometricIdentityRow[]; total: number; activeCount: number; fullyEnrolledCount: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchBiometricIdentities()
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <LightStatCard label="Enrolled Identities" value={data?.total ?? 0} icon={Fingerprint} />
        <LightStatCard label="Active" value={data?.activeCount ?? 0} icon={ShieldCheck} />
        <LightStatCard label="All 3 Modalities" value={data?.fullyEnrolledCount ?? 0} icon={ScanFace} />
      </div>

      <p className="text-xs text-gray-500">
        Enrollment metadata only — encrypted biometric templates never leave the auth service, not even to this console.
      </p>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : (
        <LightDataTable
          rows={data?.identities ?? []}
          keyField="id"
          emptyMessage="No biometric identities enrolled yet"
          columns={[
            { key: 'user', header: 'User', render: (r: BiometricIdentityRow) => <span className="font-mono text-xs">{r.user?.shortId ?? '—'}</span> },
            { key: 'name', header: 'Name', render: (r: BiometricIdentityRow) => r.user?.fullName ?? '—' },
            { key: 'status', header: 'Status', render: (r: BiometricIdentityRow) => <LightStatusBadge value={r.status} /> },
            { key: 'modalities', header: 'Modalities', render: (r: BiometricIdentityRow) => (
              <div className="flex gap-1">
                <ModalityChip label="Face" info={r.faceTemplate} />
                <ModalityChip label="Voice" info={r.voiceTemplate} />
                <ModalityChip label="Fingerprint" info={r.fingerprintTemplate} />
              </div>
            )},
            { key: 'enrolled', header: 'Enrolled', render: (r: BiometricIdentityRow) => format(new Date(r.enrolledAt), 'MMM d, yyyy') },
            { key: 'lastVerified', header: 'Last Verified', render: (r: BiometricIdentityRow) => r.lastVerifiedAt ? format(new Date(r.lastVerifiedAt), 'MMM d, yyyy HH:mm') : 'Never' },
            { key: 'fusion', header: 'Fusion Version', render: (r: BiometricIdentityRow) => r.fusionVersion },
          ]}
        />
      )}
    </div>
  );
}
