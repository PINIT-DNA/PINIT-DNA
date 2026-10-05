import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, Platform } from 'react-native';
import { buildReaderSession, newSessionId, SESSION_KEY } from './session';
import type { ReaderSession } from '../core/types';

/** One reader session for this install. This is not an authorization cache. */
export async function loadReaderSession(): Promise<ReaderSession> {
  let sessionId = await AsyncStorage.getItem(SESSION_KEY);
  if (!sessionId) {
    sessionId = newSessionId();
    await AsyncStorage.setItem(SESSION_KEY, sessionId);
  }
  const { width, height } = Dimensions.get('window');
  const screenResolution = `${Math.round(width)}x${Math.round(height)}`;
  let timezone = 'UTC';
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    timezone = 'UTC';
  }
  return buildReaderSession({
    sessionId,
    platform: `pinit-reader-mobile/${Platform.OS}`,
    screenResolution,
    timezone,
    fingerprintSource: [Platform.OS, String(Platform.Version), screenResolution, timezone].join('|'),
  });
}
