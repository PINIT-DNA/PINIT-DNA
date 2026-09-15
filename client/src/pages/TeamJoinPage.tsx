import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, RefreshCw, Users, AlertTriangle } from 'lucide-react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';
import {
  clearPendingTeamInvite,
  rememberPendingTeamInvite,
} from '../lib/team-invite';

type JoinState = 'loading' | 'ready' | 'joining' | 'done' | 'error';

interface InvitePreview {
  status?: string;
  campaignOnly?: boolean;
  organizationJoin?: boolean;
  campaignName?: string | null;
  campaignRole?: string | null;
  inviteeShortId?: string | null;
  identityMatch?: boolean;
  alreadyAccepted?: boolean;
}

export function TeamJoinPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [state, setState] = useState<JoinState>('loading');
  const [message, setMessage] = useState('Checking invitation…');
  const [role, setRole] = useState<string | null>(null);
  const [preview, setPreview] = useState<InvitePreview | null>(null);

  useEffect(() => {
    if (token?.trim()) rememberPendingTeamInvite(token);
  }, [token]);

  useEffect(() => {
    if (authLoading || !user || !token?.trim()) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data } = await api.get<{ preview: InvitePreview }>(
          `${API_BASE_URL}/organization/team/invites/preview/${encodeURIComponent(token.trim())}`,
        );
        if (cancelled) return;
        const p = data.preview ?? {};
        setPreview(p);
        if (p.alreadyAccepted) {
          clearPendingTeamInvite();
          setState('done');
          setMessage(p.campaignOnly
            ? 'You already accepted this campaign invitation.'
            : 'You are already on this team.');
          return;
        }
        if (p.identityMatch === false) {
          setState('error');
          setMessage(
            p.inviteeShortId
              ? `This invitation is for ${p.inviteeShortId}. Sign in with that Pinit account.`
              : 'This invitation is for a different Pinit account.',
          );
          return;
        }
        // Preview only. Accept is a separate click so opening the link is not a grant.
        setState('ready');
        setMessage(p.campaignOnly
          ? 'Review and accept to join this campaign as an external creator.'
          : 'Review and accept to join this organization.');
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
        setState('error');
        setMessage(msg ?? 'Could not open this invitation. It may have expired or been revoked.');
      }
    })();
    return () => { cancelled = true; };
  }, [authLoading, user, token]);

  async function accept(inviteToken: string, p?: InvitePreview) {
    setState('joining');
    setMessage(p?.campaignOnly ? 'Accepting invitation…' : 'Joining your team…');
    try {
      const { data } = await api.post<{
        success?: boolean;
        role?: string | null;
        alreadyMember?: boolean;
        campaignOnly?: boolean;
      }>(`${API_BASE_URL}/organization/team/accept`, { token: inviteToken });

      clearPendingTeamInvite();
      setRole(data.role ?? null);
      setState('done');
      const external = data.campaignOnly || p?.campaignOnly;
      setMessage(
        data.alreadyMember
          ? 'You are already on this team.'
          : external
            ? 'You joined this campaign as an external creator. You are not an organization member.'
            : 'You joined the team successfully.',
      );
      window.setTimeout(() => {
        navigate(external ? '/' : '/business/team', { replace: true });
      }, 1600);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setState('error');
      setMessage(msg ?? 'Could not join. The invite may have expired.');
    }
  }

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
        {state === 'loading' && (
          <>
            <RefreshCw size={28} className="mx-auto text-dna-400 animate-spin" />
            <h1 className="text-lg font-bold text-white">Checking invitation</h1>
            <p className="text-sm text-gray-500">{message}</p>
          </>
        )}
        {state === 'ready' && (
          <>
            <Users size={28} className="mx-auto text-dna-400" />
            <h1 className="text-lg font-bold text-white">
              {preview?.campaignOnly ? 'External creator invitation' : 'Organization invitation'}
            </h1>
            <p className="text-sm text-gray-400">
              {preview?.campaignOnly
                ? (preview.campaignName
                  ? <>Join <span className="text-white font-medium">{preview.campaignName}</span> as an external creator.</>
                  : 'Join this campaign as an external creator.')
                : (preview?.campaignName
                  ? <>Join the organization team and the campaign <span className="text-white font-medium">{preview.campaignName}</span>.</>
                  : 'Join this organization team on Pinit HUB.')}
            </p>
            <p className="text-xs text-gray-500">
              {preview?.campaignOnly
                ? 'Accepting does not add you to the organization team. You only receive the campaign access they assign afterwards.'
                : 'Accepting adds you as an organization member. Opening this page has not granted access yet.'}
            </p>
            {preview?.campaignRole && (
              <p className="text-2xs text-dna-400 font-semibold uppercase tracking-wide">
                Campaign role: {preview.campaignRole.replace(/_/g, ' ').toLowerCase()}
              </p>
            )}
            <button
              type="button"
              className="btn btn-primary btn-sm mx-auto"
              onClick={() => void accept(token.trim(), preview ?? undefined)}
            >
              Accept invitation
            </button>
          </>
        )}
        {state === 'joining' && (
          <>
            <RefreshCw size={28} className="mx-auto text-dna-400 animate-spin" />
            <h1 className="text-lg font-bold text-white">
              {preview?.campaignOnly ? 'Accepting' : 'Joining team'}
            </h1>
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
