const STORAGE_KEY = 'pinit_signin_start_method';

export type SignInStartMethod = 'face' | 'pinit_id';

export const DEFAULT_SIGN_IN_START: SignInStartMethod = 'face';

function isMethod(v: string | null): v is SignInStartMethod {
  return v === 'face' || v === 'pinit_id';
}

/** How Sign In starts on this device. Default is Face Scan. */
export function getSignInStartMethod(): SignInStartMethod {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isMethod(raw)) return raw;
  } catch { /* ignore */ }
  return DEFAULT_SIGN_IN_START;
}

export function setSignInStartMethod(method: SignInStartMethod): void {
  try {
    localStorage.setItem(STORAGE_KEY, method);
  } catch { /* ignore */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('pinit-signin-method', { detail: { method } }));
  }
}

/** Sign-in always opens the camera. A Pinit ID is never asked. */
export function resolveSignInEntryStep(
  _method: SignInStartMethod,
  _rememberedPinitId: string,
): 'face' {
  return 'face';
}

/** Server asked for the enrolled authenticator after face + PAD already succeeded. */
export function loginNeedsPasskeyFactor(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('passkey') || m.includes('authenticator registered to this pinit');
}
