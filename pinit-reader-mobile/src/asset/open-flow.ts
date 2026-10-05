import type { AccessExtras, ShareLinkView } from '../core/types';

export type OpenStep =
  | { name: 'otp' }
  | { name: 'name' }
  | { name: 'location' }
  | { name: 'load' };

/** The same gates as the browser Reader. The Hub already decided the share is active. */
export function decideNextStep(link: ShareLinkView, extras: AccessExtras): OpenStep {
  if (link.requireOtp && !link.otpVerified) return { name: 'otp' };
  if (link.requireName && !extras.recipientName) return { name: 'name' };
  if (link.requestLocation && !link.locationAlreadyShared && extras.locationShared !== true) {
    return { name: 'location' };
  }
  return { name: 'load' };
}
