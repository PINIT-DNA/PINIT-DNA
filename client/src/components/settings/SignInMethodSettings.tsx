import { useEffect, useState, type ReactNode } from 'react';
import { ScanFace, Hash } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  getSignInStartMethod,
  setSignInStartMethod,
  type SignInStartMethod,
} from '../../lib/signin-preference';

export function SignInMethodSettings({ compact }: { compact?: boolean }) {
  const [method, setMethod] = useState<SignInStartMethod>(getSignInStartMethod);

  useEffect(() => {
    const onChange = () => setMethod(getSignInStartMethod());
    window.addEventListener('pinit-signin-method', onChange);
    return () => window.removeEventListener('pinit-signin-method', onChange);
  }, []);

  function choose(next: SignInStartMethod) {
    setMethod(next);
    setSignInStartMethod(next);
    toast.success(next === 'face' ? 'Sign In will start with Face Scan' : 'Sign In will start with Pinit ID');
  }

  const options: Array<{ id: SignInStartMethod; title: string; desc: string; icon: ReactNode }> = [
    {
      id: 'face',
      title: 'Face Scan',
      desc: 'Sign in by looking at the camera.',
      icon: <ScanFace size={16} className="text-dna-400" />,
    },
    {
      id: 'pinit_id',
      title: 'Pinit ID',
      desc: 'Enter your Pinit ID, then complete Face Scan. The ID is not a password.',
      icon: <Hash size={16} className="text-dna-400" />,
    },
  ];

  return (
    <div className={compact ? '' : 'space-y-2'}>
      <p className="text-2xs text-slate-600 dark:text-gray-400 mb-3">
        Choose how Sign In starts.
      </p>
      <div className="space-y-2">
        {options.map((opt) => {
          const on = method === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => choose(opt.id)}
              className={`w-full text-left rounded-lg px-4 py-3 border transition-colors ${
                on
                  ? 'border-dna-500/60 bg-dna-500/10'
                  : 'border-slate-200 dark:border-bg-border bg-slate-50 dark:bg-bg-elevated'
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 ${
                    on ? 'border-dna-400 bg-dna-500' : 'border-gray-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-slate-900 dark:text-white flex items-center gap-2">
                    {opt.icon}
                    {opt.title}
                  </p>
                  <p className="text-2xs text-slate-600 dark:text-gray-400 mt-1">{opt.desc}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
