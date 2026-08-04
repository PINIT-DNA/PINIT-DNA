import { useCallback, useEffect, useState } from 'react';
import { api } from '../services/dashboard.api';
import { API_BASE_URL } from '../config/api.config';
import { useAuth } from '../context/AuthContext';

/** Fired after profile fullName (or related fields) are saved — Home/header refetch. */
export const PROFILE_UPDATED_EVENT = 'pinit:profile-updated';

export function notifyProfileUpdated() {
  window.dispatchEvent(new Event(PROFILE_UPDATED_EVENT));
}

export interface UserProfileSummary {
  fullName: string;
  shortId: string;
  email: string | null;
  role?: string;
  avatarUrl?: string | null;
  profileCompletion?: number;
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

let cachedProfile: UserProfileSummary | null = null;
let cachedForUserId: string | null = null;
let inflight: Promise<UserProfileSummary | null> | null = null;

export function invalidateUserProfileCache() {
  cachedProfile = null;
  cachedForUserId = null;
  inflight = null;
}

async function fetchProfile(userId: string): Promise<UserProfileSummary | null> {
  try {
    const r = await api.get(`${API_BASE_URL}/profile`);
    const p = (r.data as { profile?: UserProfileSummary })?.profile ?? null;
    if (p) {
      cachedProfile = p;
      cachedForUserId = userId;
    }
    return p;
  } catch {
    return cachedForUserId === userId ? cachedProfile : null;
  }
}

/**
 * Loads `/profile` so welcome/header UI can use the same fullName as Profile.
 * Cached per session — revisiting pages shows data instantly.
 */
export function useUserProfile() {
  const { user } = useAuth();
  const userId = user?.sub ?? null;
  const hasCache = Boolean(userId && cachedForUserId === userId && cachedProfile);

  const [profile, setProfile] = useState<UserProfileSummary | null>(
    hasCache ? cachedProfile : null,
  );
  const [loading, setLoading] = useState(Boolean(userId) && !hasCache);
  const [refreshKey, setRefreshKey] = useState(0);

  const refetch = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    if (cachedForUserId === userId && cachedProfile) {
      setProfile(cachedProfile);
      setLoading(false);
    }

    let cancelled = false;
    const silent = Boolean(cachedForUserId === userId && cachedProfile);
    if (!silent) setLoading(true);

    void (async () => {
      try {
        if (!inflight) {
          inflight = fetchProfile(userId).finally(() => { inflight = null; });
        }
        const p = await inflight;
        if (cancelled) return;
        setProfile(p);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  useEffect(() => {
    const onUpdated = () => refetch();
    window.addEventListener(PROFILE_UPDATED_EVENT, onUpdated);
    return () => window.removeEventListener(PROFILE_UPDATED_EVENT, onUpdated);
  }, [refetch]);

  const displayName = resolveDisplayName(profile?.fullName, user?.name);
  const firstName = firstNameFrom(displayName);

  return { profile, displayName, firstName, loading, refetch };
}
