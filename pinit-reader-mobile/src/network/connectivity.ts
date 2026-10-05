import * as Network from 'expo-network';
import { OFFLINE_MESSAGE } from '../core/validation';

/** Null means the device appears online, or the check itself could not run. */
export async function offlineMessage(): Promise<string | null> {
  try {
    const state = await Network.getNetworkStateAsync();
    if (state.isConnected === false || state.isInternetReachable === false) {
      return OFFLINE_MESSAGE;
    }
  } catch {
    return null;
  }
  return null;
}
