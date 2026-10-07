import { ScanFace } from 'lucide-react';

export function SignInMethodSettings({ compact }: { compact?: boolean }) {
  return (
    <div className={compact ? '' : 'space-y-2'}>
      <p className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
        <ScanFace size={16} className="text-dna-400" />
        Face Scan
      </p>
      <p className="text-2xs text-slate-600 dark:text-gray-400 mt-1">
        Sign in by looking at the camera. On a known device this is a 1:1 check. Fingerprint stays optional.
      </p>
    </div>
  );
}
