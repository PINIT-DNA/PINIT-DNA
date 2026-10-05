import * as Location from 'expo-location';
import { Linking, Platform } from 'react-native';
import type { AccessExtras } from '../core/types';
import { LOCATION_REQUIRED_MESSAGE, LOCATION_TURN_ON_MESSAGE } from '../core/validation';

/**
 * One GPS reading for this open. The app does not watch the device after this.
 * If location is switched off, Android shows the system prompt to turn it on.
 * iOS opens Settings when the system cannot show that prompt itself.
 * A refusal stops the open. The Hub still records the network address on its own.
 */
export async function captureRequiredLocation(): Promise<
  | { ok: true; extras: AccessExtras }
  | { ok: false; message: string }
> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    return { ok: false, message: LOCATION_REQUIRED_MESSAGE };
  }

  const servicesReady = await ensureLocationServices();
  if (servicesReady) return { ok: false, message: servicesReady };

  try {
    const fix = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const accuracy = fix.coords.accuracy ?? 999;
    const place = await describePlace(fix.coords.latitude, fix.coords.longitude);
    return {
      ok: true,
      extras: {
        locationShared: true,
        locationSource: accuracy <= 75 ? 'gps' : 'network',
        gpsLat: fix.coords.latitude,
        gpsLng: fix.coords.longitude,
        gpsAccuracy: fix.coords.accuracy ?? undefined,
        gpsTimestamp: new Date(fix.timestamp).toISOString(),
        ...place,
      },
    };
  } catch {
    return { ok: false, message: LOCATION_TURN_ON_MESSAGE };
  }
}

async function describePlace(latitude: number, longitude: number): Promise<{
  gpsCity?: string;
  gpsVillage?: string;
  gpsDistrict?: string;
  gpsState?: string;
  gpsPincode?: string;
  gpsFullAddress?: string;
}> {
  try {
    const [place] = await Location.reverseGeocodeAsync({ latitude, longitude });
    if (!place) return {};
    const village = place.name || place.street || place.district || undefined;
    const district = place.city || place.subregion || undefined;
    const state = place.region || undefined;
    const full = [place.name, place.street, place.district, place.city, place.subregion, place.region, place.postalCode, place.country]
      .filter((part): part is string => Boolean(part && part.trim()))
      .filter((part, index, all) => all.indexOf(part) === index)
      .join(', ');
    return {
      gpsVillage: village,
      gpsDistrict: district,
      gpsState: state,
      gpsCity: place.city || undefined,
      gpsPincode: place.postalCode || undefined,
      gpsFullAddress: full || undefined,
    };
  } catch {
    return {};
  }
}

async function ensureLocationServices(): Promise<string | null> {
  const status = await Location.getProviderStatusAsync();
  if (status.locationServicesEnabled) return null;

  if (Platform.OS === 'android') {
    try {
      await Location.enableNetworkProviderAsync();
    } catch {
      return LOCATION_TURN_ON_MESSAGE;
    }
    const again = await Location.getProviderStatusAsync();
    return again.locationServicesEnabled ? null : LOCATION_TURN_ON_MESSAGE;
  }

  await Linking.openSettings();
  return 'Turn on location for PINIT Reader, then tap Allow Location again.';
}
