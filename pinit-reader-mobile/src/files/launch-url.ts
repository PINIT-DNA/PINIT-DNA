/** True when Android or iOS handed the app a file, not the Expo dev-server URL. */
export function isPinitLaunchUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const value = url.trim().toLowerCase();
  if (!value || value.startsWith('exp:') || value.startsWith('exps:')) return false;
  if (value.startsWith('content:') || value.startsWith('file:')) return true;
  return value.includes('.pinit');
}
