/**
 * New account creation is closed unless REGISTRATION_OPEN=true.
 * Existing sign-in is not part of this gate.
 */
import { Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { authService } from './auth.service';

export const REGISTRATION_CLOSED_MESSAGE =
  'New registrations are closed. Sign in if you already have a Pinit account.';

export function registrationIsOpen(): boolean {
  return config.registration.open;
}

export function blockNewRegistration(_req: Request, res: Response, next: NextFunction): void {
  if (registrationIsOpen()) {
    next();
    return;
  }
  res.status(403).json({
    success: false,
    message: REGISTRATION_CLOSED_MESSAGE,
    error: REGISTRATION_CLOSED_MESSAGE,
  });
}

/** Passkey enrollment on an existing signed-in account may continue. A new account may not. */
export function blockNewRegistrationUnlessSignedIn(req: Request, res: Response, next: NextFunction): void {
  if (registrationIsOpen()) {
    next();
    return;
  }
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try {
      authService.verifyAccess(header.slice(7));
      next();
      return;
    } catch {
      /* not a live session */
    }
  }
  blockNewRegistration(req, res, next);
}
