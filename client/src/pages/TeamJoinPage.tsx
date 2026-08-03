import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, RefreshCw, Users, AlertTriangle } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import {
  clearPendingTeamInvite,
  rememberPendingTeamInvite,
} from '../lib/team-invite';

type JoinState = 'joining' | 'done' | 'error';

export function TeamJoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<JoinState>('joining');
  const [message, setMessage] = useState('Joining your team…');
  const [role, setRole] = useState<string | null>(null);
  const attempted = useRef(false);

  // Always stash token first so login → re-open still joins.
  useEffect(() => {
    if (token?.trim()) rememberPendingTeamInvite(token);
  }, [token]);

  useEffect(() => {
    if (authLoading || !user || !token?.trim()) return;
    if (attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        const { data } = await api.post<{
          success?: boolean;
          role?: string;
          alreadyMember?: boolean;
          error?: string;
        }>(`${API_BASE_URL}/organization/team/accept`, { token: token.trim() });

        clearPendingTeamInvite();
        setRole(data.role ?? null);
        setState('done');
        setMessage(
          data.alreadyMember
            ? 'You are already on this team.'
            : 'You joined the team successfully.',
        );
        window.setTimeout(() => {
          navigate('/business/team', { replace: true });
        }, 1600);
      } catch (err: unknown) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const msg = (err as any)?.response?.data?.error as string | undefined;
        setState('error');
        setMessage(msg ?? 'Could not join this team. The invite may have expired.');
      }
    })();
  }, [authLoading, user, token, navigate]);

  if (!token?.trim()) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
        <div className="card text-center space-y-3 py-10 max-w-md w-full">
          <AlertTriangle size={28} className="mx-auto text-warning" />
          <h1 className="text-lg font-bold text-white">Invalid invite</h1>
          <p className="text-sm text-gray-500">This invite link is missing or broken.</p>
          <Link to="/login" className="btn btn-primary btn-sm">Sign in</Link>
        </div>
      </div>
    );
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bg-base flex items-center justify-center">
        <RefreshCw size={24} className="animate-spin text-dna-400" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="min-h-screen bg-bg-base flex items-center justify-center p-4">
      <div className="card text-center space-y-4 py-10 max-w-md w-full">
        {state === 'joining' && (
          <>
            <RefreshCw size={28} className="mx-auto text-dna-400 animate-spin" />
            <h1 className="text-lg font-bold text-white">Joining team</h1>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}
        {state === 'done' && (
          <>
            <CheckCircle2 size={28} className="mx-auto text-success" />
            <h1 className="text-lg font-bold text-white">Welcome</h1>
            <p className="text-sm text-gray-500">{message}</p>
            {role && (
              <p className="text-2xs text-dna-400 font-semibold uppercase tracking-wide">
                Role: {role}
              </p>
            )}
            <p className="text-2xs text-gray-500">Taking you to Team…</p>
          </>
        )}
        {state === 'error' && (
          <>
            <AlertTriangle size={28} className="mx-auto text-warning" />
            <h1 className="text-lg font-bold text-white">Could not join</h1>
            <p className="text-sm text-gray-500">{message}</p>
            <div className="flex flex-col sm:flex-row gap-2 justify-center pt-2">
              <Link to="/business/team" className="btn btn-secondary btn-sm gap-1.5">
                <Users size={13} /> Team page
              </Link>
              <Link to="/" className="btn btn-primary btn-sm">
                Go home
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
