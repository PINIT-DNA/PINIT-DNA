/**
 * PINIT — native (APK) vs web detection.
 *
 * The APK (Capacitor) renders a SEPARATE app UI (splash → biometric/face login
 * → app dashboard). The web browser keeps the existing UI, untouched.
 *
 * For previewing the native UI in a normal browser, append `?native=1` to the
 * URL (persisted in localStorage) — `?native=0` turns it back off.
 */
import { Capacitor } from '@capacitor/core';

const FORCE_KEY = 'pinit_force_native';

function readOverride(): boolean | null {
  if (typeof window === 'undefined') return null;
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('native')) {
      const on = q.get('native') !== '0';
      localStorage.setItem(FORCE_KEY, on ? '1' : '0');
      return on;
    }
    const stored = localStorage.getItem(FORCE_KEY);
    if (stored === '1') return true;
    if (stored === '0') return false;
  } catch {
    /* ignore */
  }
  return null;
}

const override = readOverride();

/** True when running inside the APK (or when forced on for preview). */
export const IS_NATIVE_APP: boolean =
  override !== null ? override : Capacitor.isNativePlatform();
