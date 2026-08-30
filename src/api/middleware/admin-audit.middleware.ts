/**
 * Baseline admin-audit logger — mounted on the whole super-admin router.
 *
 * Individual controllers that need richer detail (before/after state,
 * a reason) call adminAuditService.record() themselves and set
 * res.locals.adminAuditRecorded = true so this middleware skips logging
 * a second, thinner entry for the same request. Every other mutation —
 * including ones nobody remembers to instrument later — still gets a
 * baseline row: who, what endpoint, when, from where.
 */
import { Request, Response, NextFunction } from 'express';
import { adminAuditService } from '../../services/audit/admin-audit.service';

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function auditAdminMutations(req: Request, res: Response, next: NextFunction): void {
  if (!MUTATING_METHODS.has(req.method)) {
    next();
    return;
  }

  res.on('finish', () => {
    if (res.locals['adminAuditRecorded']) return;
    if (res.statusCode >= 400) return;

    const user = (req as { user?: { sub?: string; shortId?: string } }).user;
    if (!user?.sub) return;

    void adminAuditService.record({
      actorUserId: user.sub,
      actorShortId: user.shortId ?? null,
      action: `${req.method} ${req.route?.path ?? req.path}`,
      req,
    });
  });

  next();
}
