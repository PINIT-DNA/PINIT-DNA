import { useState } from 'react';
import { BiometricIdentityPage } from './BiometricIdentityPage';
import { VerificationRequestsPanel } from './VerificationRequestsPanel';

export function IdentityVerificationPage() {
  const [tab, setTab] = useState<'biometric' | 'verification'>('verification');

  return (
    <div>
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {[
          { id: 'verification' as const, label: 'Verification Requests' },
          { id: 'biometric' as const, label: 'Biometric Enrollment' },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px ${
              tab === t.id ? 'border-indigo-600 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'verification' ? <VerificationRequestsPanel /> : <BiometricIdentityPage />}
    </div>
  );
}
