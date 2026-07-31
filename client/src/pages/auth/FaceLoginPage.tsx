import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { FaceAuth } from '../../components/auth/FaceAuth';
import { Dna, Shield, Fingerprint } from 'lucide-react';

export function FaceLoginPage() {
  const location = useLocation();
  const [mode, setMode] = useState<'login' | 'register'>(
    location.pathname.includes('register') ? 'register' : 'login',
  );
  const navigate = useNavigate();
  const handleSuccess = (data: Record<string, unknown>) => {
    if (typeof data.accessToken === 'string') {
      localStorage.setItem('pinit_access_token', data.accessToken);
      if (typeof data.refreshToken === 'string') {
        localStorage.setItem('pinit_refresh_token', data.refreshToken);
      }
    }
    setTimeout(() => { window.location.href = '/'; }, 1200);
  };

  return (
    <div className="min-h-screen bg-bg-base flex flex-col items-center justify-center px-4">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-dna-500 to-indigo-600 flex items-center justify-center shadow-glow-purple">
          <Dna size={18} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black text-white tracking-tight">
            PINIT<span className="text-dna-400">-DNA</span>
          </h1>
          <p className="text-[9px] text-gray-500 font-bold tracking-[3px] uppercase">Digital File Security</p>
        </div>
      </div>

      {/* Mode title */}
      <div className="text-center mb-6 mt-4">
        <h2 className="text-lg font-bold text-white">
          {mode === 'login' ? 'Welcome Back' : 'Create Your Identity'}
        </h2>
        <p className="text-xs text-gray-500 mt-1">
          {mode === 'login'
            ? 'Look at the camera to sign in'
            : 'Register your face — no passwords, no manual entry'}
        </p>
      </div>

      {/* Face Auth */}
      <FaceAuth
        mode={mode}
        onSuccess={handleSuccess}
        onSwitchMode={() => setMode(mode === 'login' ? 'register' : 'login')}
      />

      {/* Security badges */}
      <div className="flex flex-wrap justify-center gap-2 mt-6">
        <div className="flex items-center gap-1.5 bg-bg-elevated border border-bg-border rounded-full px-3 py-1.5">
          <Shield size={11} className="text-success" />
          <span className="text-[10px] text-gray-400 font-semibold">End-to-End Encrypted</span>
        </div>
        <div className="flex items-center gap-1.5 bg-bg-elevated border border-bg-border rounded-full px-3 py-1.5">
          <Fingerprint size={11} className="text-dna-400" />
          <span className="text-[10px] text-gray-400 font-semibold">Face Never Leaves Device</span>
        </div>
      </div>

      {/* Fallback link */}
      <button
        onClick={() => navigate('/login')}
        className="mt-4 text-xs text-gray-600 hover:text-gray-400 transition"
      >
        Use password login instead
      </button>
    </div>
  );
}
