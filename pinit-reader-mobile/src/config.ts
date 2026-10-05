import Constants from 'expo-constants';
import { Platform } from 'react-native';

const PRODUCTION_HUB = 'https://pinit-dna-uf5y.onrender.com/api/v1';

/**
 * Development addresses:
 * - Android emulator: 10.0.2.2 is the computer, not the phone.
 * - iOS simulator: 127.0.0.1 is the computer.
 * - Physical phone: 127.0.0.1 is the phone. Use adb reverse, or set
 *   EXPO_PUBLIC_HUB_API_BASE to http://<computer-lan-ip>:4000/api/v1.
 */
export function hubApiBase(): string {
  const configured = process.env.EXPO_PUBLIC_HUB_API_BASE?.trim().replace(/\/$/, '');
  if (configured) return configured;
  if (!__DEV__) return PRODUCTION_HUB;
  if (Platform.OS === 'android' && Constants.isDevice === false) {
    return 'http://10.0.2.2:4000/api/v1';
  }
  return 'http://127.0.0.1:4000/api/v1';
}
