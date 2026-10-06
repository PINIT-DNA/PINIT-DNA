import { FACE_AUTH_STEPS, mayIssueSession, nextFaceAuthStep } from '../../src/services/auth/face-auth-machine';

describe('face-first auth order', () => {
  it('runs capture, then liveness, then match, then session', () => {
    expect(FACE_AUTH_STEPS).toEqual(['capture', 'pad', 'match', 'session']);
    expect(nextFaceAuthStep('capture')).toBe('pad');
    expect(nextFaceAuthStep('pad')).toBe('match');
    expect(nextFaceAuthStep('match')).toBe('session');
    expect(nextFaceAuthStep('session')).toBeNull();
  });

  it('does not issue a session before liveness and a match', () => {
    expect(mayIssueSession(false, true)).toBe(false);
    expect(mayIssueSession(true, false)).toBe(false);
    expect(mayIssueSession(true, true)).toBe(true);
  });
});
