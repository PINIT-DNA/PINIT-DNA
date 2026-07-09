import { Request, Response, NextFunction } from 'express';
import { authService } from '../../services/auth/auth.service';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const q = req.query['token'];
  if (typeof q === 'string' && q.length > 0) return q;
  return null;
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: 'Unauthorized' });
    return;
  }
  try {
    const payload = authService.verifyAccess(token);
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ success: false, error: 'Invalid or expired token' });
  }
}

/** SSE / EventSource — accepts Bearer header or ?token= query param */
export function requireAuthSse(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, next);
}
