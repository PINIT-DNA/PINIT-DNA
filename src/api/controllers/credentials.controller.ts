import { Request, Response, NextFunction } from 'express';
import { getAuthUserId } from '../../lib/tenant-scope';
import { getMyCredential, listMyCredentials } from '../../services/credentials/credential.service';

export async function listMyCredentialsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const result = await listMyCredentials(userId);
    res.status(200).json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
}

export async function getMyCredentialHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = getAuthUserId(req);
    const credentialId = String(req.params['credentialId'] || '').trim();
    const credential = await getMyCredential(userId, credentialId);
    res.status(200).json({ success: true, credential });
  } catch (err) {
    next(err);
  }
}
