import type { HubFailureKind, PinitErrorCode } from './types';

export const LOCATION_REQUIRED_MESSAGE = 'Location permission is required to open this share.';
export const LOCATION_TURN_ON_MESSAGE = 'Turn on location to open this share.';
export const OFFLINE_MESSAGE = 'Internet connection required to open this share.';

export const READER_MESSAGES: Record<PinitErrorCode | HubFailureKind | 'download_off', string> = {
  invalid_file: 'Invalid PINIT file.',
  unsupported_version: 'This PINIT file version is not supported.',
  missing_token: 'This PINIT file does not contain a valid share token.',
  corrupted: 'This PINIT file is corrupted or invalid.',
  expired: 'This share has expired.',
  revoked: 'This share was turned off by the owner.',
  exhausted: 'This share has reached its view limit.',
  unauthorized: 'You do not have access to this file.',
  otp_required: 'This file needs a verification code.',
  device_restricted: 'This device is not allowed to open this file.',
  download_restricted: 'This file can no longer be opened because its download limit was reached.',
  download_off: 'Saving this file is turned off. You can still view it here.',
  unavailable: 'This share is not available.',
  network: 'Unable to connect to PINIT.',
  hub_unavailable: 'PINIT Hub is unavailable right now. Try again in a moment.',
};

export function readerMessage(code: PinitErrorCode | HubFailureKind): string {
  return READER_MESSAGES[code];
}
