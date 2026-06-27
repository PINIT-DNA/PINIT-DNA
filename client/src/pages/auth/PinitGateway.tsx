import { useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { LoginFlow } from './LoginFlow';
import { RegistrationFlow } from './RegistrationFlow';

function Booting() {
  return (
    <div className="pinit-auth" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <div className="pa-spin" style={{ width: 28, height: 28, border: '3px solid #e3e7f1', borderTopColor: '#6366f1', borderRadius: '50%' }} />
    </div>
  );
}

function useWasAuthedOnMount(): boolean | null {
  const { user, loading } = useAuth();
  const snap = useRef<boolean | null>(null);
  if (loading) return null;
  if (snap.current === null) snap.current = Boolean(user);
  return snap.current;
}

export function PinitGateway() {
  const wasAuthed = useWasAuthedOnMount();
  if (wasAuthed === null) return <Booting />;
  if (wasAuthed) return <Navigate to="/" replace />;
  return <LoginFlow />;
}

export function RegisterGateway() {
  const wasAuthed = useWasAuthedOnMount();
  if (wasAuthed === null) return <Booting />;
  if (wasAuthed) return <Navigate to="/" replace />;
  return <RegistrationFlow />;
}
