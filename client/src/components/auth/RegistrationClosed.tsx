import { Link } from 'react-router-dom';
import { AuthShell } from './AuthShell';
import { REGISTRATION_CLOSED_MESSAGE } from '../../lib/registration-gate';

export function RegistrationClosed() {
  return (
    <AuthShell steps={0} current={0} tagline="Sign in">
      <div className="pa-card" style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, fontWeight: 800 }}>Registrations are closed</h1>
        <p className="pa-muted" style={{ fontSize: 14, marginTop: 8 }}>{REGISTRATION_CLOSED_MESSAGE}</p>
        <Link to="/login" className="pa-btn" style={{ marginTop: 22, display: 'inline-block' }}>
          Sign in
        </Link>
      </div>
    </AuthShell>
  );
}
