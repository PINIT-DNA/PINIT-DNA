/** Fields the Reader is willing to read from a .pinit carrier. */
export interface PinitDocument {
  version: 1;
  token: string;
  name?: string;
}

export type PinitErrorCode =
  | 'invalid_file'
  | 'unsupported_version'
  | 'missing_token'
  | 'corrupted';

export type PinitParseResult =
  | { ok: true; document: PinitDocument }
  | { ok: false; code: PinitErrorCode; message: string };

export interface PinitFileInput {
  name: string;
  size: number;
  text: () => Promise<string>;
}

/** Share facts the Reader needs. Authorization stays on the Hub. */
export interface ShareLinkView {
  filename: string;
  mimeType: string;
  isActive: boolean;
  inactiveReason: 'expired' | 'exhausted' | 'revoked' | 'one_time' | 'tampered' | null;
  requireOtp: boolean;
  otpVerified: boolean;
  requireName: boolean;
  allowDownload: boolean;
  requestLocation: boolean;
  locationAlreadyShared: boolean;
  viewerRevoked: boolean;
}

export type HubFailureKind =
  | 'expired'
  | 'revoked'
  | 'exhausted'
  | 'unauthorized'
  | 'otp_required'
  | 'device_restricted'
  | 'download_restricted'
  | 'unavailable'
  | 'network'
  | 'hub_unavailable';

export interface HubFailure {
  ok: false;
  kind: HubFailureKind;
  message: string;
}

export interface ReaderSession {
  sessionId: string;
  appVersion: string;
  platform: string;
  deviceFingerprint: string;
  screenResolution: string;
  timezone: string;
}

export interface AccessExtras {
  recipientName?: string;
  locationShared?: boolean;
  locationSource?: 'gps' | 'network' | 'ip';
  gpsLat?: number;
  gpsLng?: number;
  gpsAccuracy?: number;
  gpsTimestamp?: string;
}
