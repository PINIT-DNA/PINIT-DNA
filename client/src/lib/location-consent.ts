/**
 * Optional browser geolocation for custody tracking (never required).
 * Location is sent to PINIT only when the user enables the toggle and grants permission.
 */

export interface CustodyLocation {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export async function requestCustodyLocation(): Promise<CustodyLocation | null> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return null;
  }

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        });
      },
      () => resolve(null),
      {
        enableHighAccuracy: false,
        timeout: 12_000,
        maximumAge: 60_000,
      },
    );
  });
}
