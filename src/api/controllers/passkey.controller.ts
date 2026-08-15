import { Request, Response, NextFunction } from 'express';
import {
  startPasskeyRegistration,
  finishPasskeyRegistration,
  startPasskeyLogin,
  finishPasskeyLogin,
} from '../../services/auth/webauthn.service';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/server';

function originOf(req: Request): string | undefined {
  const o = req.headers.origin;
  return typeof o === 'string' ? o : undefined;
}

export async function passkeyRegisterStart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as { user?: { sub?: string } }).user?.sub;
    const userName = (req as { user?: { shortId?: string } }).user?.shortId;
    const result = await startPasskeyRegistration({
      originHeader: originOf(req),
      userId,
      userName,
    });
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.message, reason: result.reason });
      return;
    }
    res.json({ success: true, registrationId: result.registrationId, options: result.options });
  } catch (err) {
    next(err);
  }
}

export async function passkeyRegisterFinish(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { registrationId, credential } = req.body as {
      registrationId?: string;
      credential?: RegistrationResponseJSON;
    };
    const bindUserId = (req as { user?: { sub?: string } }).user?.sub;
    if (!registrationId || !credential) {
      res.status(400).json({ success: false, message: 'registrationId and credential are required.' });
      return;
    }
    const result = await finishPasskeyRegistration({
      registrationId,
      credential,
      originHeader: originOf(req),
      bindUserId,
    });
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.message, reason: result.reason });
      return;
    }
    res.json({
      success: true,
      credentialId: result.credentialId,
      pendingToken: result.pendingToken,
      userId: result.userId,
    });
  } catch (err) {
    next(err);
  }
}

export async function passkeyLoginStart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { claimedShortId, claimedUserId, pinitId, shortId } = req.body as {
      claimedShortId?: string;
      claimedUserId?: string;
      pinitId?: string;
      shortId?: string;
    };
    const result = await startPasskeyLogin({
      originHeader: originOf(req),
      claimedShortId: claimedShortId || pinitId || shortId,
      claimedUserId,
    });
    if (!result.ok) {
      res.status(400).json({ success: false, message: result.message, reason: result.reason });
      return;
    }
    res.json({
      success: true,
      loginId: result.loginId,
      options: result.options,
      claimedUserId: result.claimedUserId,
    });
  } catch (err) {
    next(err);
  }
}

export async function passkeyLoginFinish(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { loginId, credential } = req.body as {
      loginId?: string;
      credential?: AuthenticationResponseJSON;
    };
    if (!loginId || !credential) {
      res.status(400).json({ success: false, message: 'loginId and credential are required.' });
      return;
    }
    const result = await finishPasskeyLogin({ loginId, credential });
    if (!result.ok) {
      res.status(401).json({ success: false, message: result.message, reason: result.reason });
      return;
    }
    res.json({
      success: true,
      webauthnSession: result.webauthnSession,
      credentialId: result.credentialId,
    });
  } catch (err) {
    next(err);
  }
}
