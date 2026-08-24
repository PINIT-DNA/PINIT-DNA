/**
 * Role-based access control middleware.
 * SUPER_ADMIN — enterprise console only.
 * Does not affect tenant-scoped user APIs.
 */
import { Request, Response, NextFunction } from 'express';
import { prisma } from '../../lib/prisma';
import { AppError } from './error.middleware';
import { isPlatformOwnerShortId } from '../../lib/platform-owner';
import type { UserRole } from '@prisma/client';

export type AppRole = UserRole;

function getUserId(req: Request): string | null {
  return (req as { user?: { sub?: string } }).user?.sub ?? null;
}

async function loadRole(userId: string): Promise<AppRole | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive) return null;
  return user.role;
}

async function loadRoleAndShortId(
  userId: string,
): Promise<{ role: AppRole; shortId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true, shortId: true },
  });
  if (!user?.isActive) return null;
  return { role: user.role, shortId: user.shortId };
}

/** Platform owner only — SUPER_ADMIN + allowlisted Pinit shortId */
export function requireSuperAdmin(req: Request, _res: Response, next: NextFunction): void {
  const userId = getUserId(req);
  if (!userId) {
    next(new AppError(401, 'Not authenticated'));
    return;
  }
  loadRoleAndShortId(userId)
    .then((row) => {
      if (!row || row.role !== 'SUPER_ADMIN' || !isPlatformOwnerShortId(row.shortId)) {
        next(new AppError(403, 'Super Admin access required'));
        return;
      }
      next();
    })
    .catch(() => next(new AppError(500, 'Auth check failed')));
}

/** ADMIN or SUPER_ADMIN — optional shared elevated routes */
export function requireAdminOrSuper(req: Request, _res: Response, next: NextFunction): void {
  const userId = getUserId(req);
  if (!userId) {
    next(new AppError(401, 'Not authenticated'));
    return;
  }
  loadRole(userId)
    .then((role) => {
      if (role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
        next(new AppError(403, 'Admin access required'));
        return;
      }
      next();
    })
    .catch(() => next(new AppError(500, 'Auth check failed')));
}
