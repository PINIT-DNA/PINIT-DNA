import { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { isDeviceRegistered } from '../../lib/hoid';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid #e3e7f1', borderTopColor: '#6366f1', borderRadius: '50%' }} />
    </div>
  );
}

/**
 * Snapshot whether the user was ALREADY authenticated on first mount.
 *
 * We must not redirect reactively the instant `user` becomes set mid-flow —
 * otherwise the verification success screen (which sets the session) would be
 * skipped. The flow's own "Enter PINIT" button performs the navigation.
 */
function useWasAuthedOnMount(): boolean | null {
  const { user, loading } = useAuth();
  const snap = useRef<boolean | null>(null);
  if (loading) return null;
  if (snap.current === null) snap.current = Boolean(user);
  return snap.current;
}

/**
 * App-launch decision point (mounted at `/login`):
 *   already signed in      → Dashboard
 *   device has an HOID      → returning-user Login flow
 *   first time on device    → Registration flow
 */
export function PinitGateway() {
  const wasAuthed = useWasAuthedOnMount();
  if (wasAuthed === null) return <Booting />;
  if (wasAuthed) return <Navigate to="/" replace />;
  return isDeviceRegistered() ? <LoginFlow /> : <Navigate to="/register" replace />;
}

/** `/register` — forces the Registration flow (also reachable via "use a different identity"). */
export function RegisterGateway() {
  const wasAuthed = useWasAuthedOnMount();
  if (wasAuthed === null) return <Booting />;
  if (wasAuthed) return <Navigate to="/" replace />;
  return <RegistrationFlow />;
}
