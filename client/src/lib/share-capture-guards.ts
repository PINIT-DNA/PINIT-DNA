/**
 * Copy / screenshot / print signals for shared pages.
 *
 * Only log what the browser can actually confirm. Do not treat tab switches,
 * focus loss, or "this looks like a screenshot" as a capture.
 */

export type CaptureGuardAction =
  | 'COPY_ATTEMPT'
  | 'SCREENSHOT_ATTEMPT'
  | 'PRINT_ATTEMPT'
  | 'SCREEN_RECORDING_ATTEMPT';

const COOLDOWN_MS = 1500;

function isAppleTouch(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isMacDesktop(): boolean {
  return /Mac/.test(navigator.platform) && !isAppleTouch();
}

function isConfirmedScreenshotShortcut(e: KeyboardEvent): boolean {
  const key = (e.key || '').toLowerCase();
  if (e.key === 'PrintScreen' || key === 'printscreen') return true;

  // macOS screen capture: Cmd+Shift+3 / 4 / 5. Cmd+Shift+S is Save / other apps.
  if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && ['3', '4', '5'].includes(key)) {
    return isMacDesktop() || isAppleTouch();
  }

  // Windows Snipping Tool: Win+Shift+S. The Windows key is metaKey in Chromium.
  if (e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey && key === 's') {
    return !isMacDesktop() && !isAppleTouch();
  }

  return false;
}

function isGameBarRecordShortcut(e: KeyboardEvent): boolean {
  const key = (e.key || '').toLowerCase();
  // Win+Alt+R only. Bare Alt+R is used by many sites and is not a capture.
  return Boolean(e.altKey && e.metaKey && !e.ctrlKey && key === 'r');
}

export function attachShareCaptureGuards(track: (action: CaptureGuardAction) => void): () => void {
  const last: Record<CaptureGuardAction, number> = {
    COPY_ATTEMPT: 0,
    SCREENSHOT_ATTEMPT: 0,
    PRINT_ATTEMPT: 0,
    SCREEN_RECORDING_ATTEMPT: 0,
  };

  const fire = (action: CaptureGuardAction) => {
    const now = Date.now();
    if (now - last[action] < COOLDOWN_MS) return;
    last[action] = now;
    track(action);
  };

  const onCopy = () => {
    fire('COPY_ATTEMPT');
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (isConfirmedScreenshotShortcut(e)) {
      fire('SCREENSHOT_ATTEMPT');
      return;
    }
    if (isGameBarRecordShortcut(e)) {
      fire('SCREEN_RECORDING_ATTEMPT');
    }
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.key === 'PrintScreen' || (e.key || '').toLowerCase() === 'printscreen') {
      fire('SCREENSHOT_ATTEMPT');
    }
  };

  const onPrint = () => fire('PRINT_ATTEMPT');

  document.addEventListener('copy', onCopy, true);
  document.addEventListener('cut', onCopy, true);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  window.addEventListener('beforeprint', onPrint);

  // iOS hardware screenshots often hide the page briefly without PrintScreen.
  // Android screenshots usually do not — a short hide there is a tab/app switch.
  let hiddenAt = 0;
  let sawPageHide = false;
  const onPageHide = () => {
    sawPageHide = true;
  };
  const onVisibility = () => {
    if (!isAppleTouch()) return;
    if (document.hidden) {
      hiddenAt = Date.now();
      sawPageHide = false;
      return;
    }
    const dur = hiddenAt ? Date.now() - hiddenAt : 0;
    hiddenAt = 0;
    if (sawPageHide) return;
    if (dur >= 160 && dur <= 650) fire('SCREENSHOT_ATTEMPT');
  };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);

  let displayPerm: PermissionStatus | null = null;
  const onDisplayCapture = () => {
    if (displayPerm?.state === 'granted') fire('SCREEN_RECORDING_ATTEMPT');
  };
  try {
    void navigator.permissions?.query({ name: 'display-capture' as PermissionName }).then((status) => {
      displayPerm = status;
      status.addEventListener('change', onDisplayCapture);
      // Do not log just because permission was granted earlier — that is not a capture.
    }).catch(() => {});
  } catch { /* PermissionName not supported */ }

  return () => {
    document.removeEventListener('copy', onCopy, true);
    document.removeEventListener('cut', onCopy, true);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('beforeprint', onPrint);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onPageHide);
    displayPerm?.removeEventListener('change', onDisplayCapture);
  };
}
