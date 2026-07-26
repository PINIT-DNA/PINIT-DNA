import { useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';

export interface UserProfileSummary {
  fullName: string;
  shortId: string;
  email: string | null;
  role?: string;
  avatarUrl?: string | null;
}

const PLACEHOLDER_NAMES = new Set([
  'pinit user',
  'pinit',
  'admin',
  'user',
  'there',
]);

/** True when a stored name is a real profile name (not a brand/placeholder default). */
export function isRealDisplayName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? '';
  if (!trimmed) return false;
  return !PLACEHOLDER_NAMES.has(trimmed.toLowerCase());
}

/** Prefer profile fullName, then JWT name — never brand placeholders. */
export function resolveDisplayName(
  profileName: string | null | undefined,
  jwtName: string | null | undefined,
  fallback = 'there',
): string {
  if (isRealDisplayName(profileName)) return profileName!.trim();
  if (isRealDisplayName(jwtName)) return jwtName!.trim();
  return fallback;
}

export function firstNameFrom(displayName: string): string {
  const first = displayName.trim().split(/\s+/)[0];
  return first || displayName;
}

/**
 * Loads `/profile` so welcome/header UI can use the same fullName as Profile.
 */
export function useUserProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfileSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.sub) {
      setProfile(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api.get(`${API_BASE_URL}/profile`)
      .then((r) => {
        if (cancelled) return;
        const p = (r.data as { profile?: UserProfileSummary })?.profile;
        setProfile(p ?? null);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [user?.sub]);

  const displayName = resolveDisplayName(profile?.fullName, user?.name);
  const firstName = firstNameFrom(displayName);

  return { profile, displayName, firstName, loading };
}
