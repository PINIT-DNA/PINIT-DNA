/**
 * PINIT-DNA — Face Recognition Authentication Controller
 *
 * POST /api/v1/auth/face/register  — Register face + create account (no manual entry)
 * POST /api/v1/auth/face/login     — Login via face match
 * GET  /api/v1/auth/face/status    — Check if current user has face registered
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { AppError } from '../middleware/error.middleware';

import { config } from '../../config';
const JWT_SECRET = config.jwt.secret;
/** Login: same person across lighting/camera (face-api typical match < 0.55) */
const LOGIN_THRESHOLD = 0.55;
/** Register: block duplicate faces only when very close */
const DUPLICATE_THRESHOLD = 0.42;

function normalizeEmbedding(embedding: number[]): number[] {
  let norm = 0;
  for (const v of embedding) norm += v * v;
  norm = Math.sqrt(norm) || 1;
  return embedding.map((v) => v / norm);
}

function euclideanDistance(a: number[], b: number[]): number {
  if (a.length !== b.length) return Infinity;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += (a[i]! - b[i]!) ** 2;
  }
  return Math.sqrt(sum);
}

function createTokens(user: { id: string; shortId: string; fullName: string; role: string }) {
  const accessToken = jwt.sign(
    { sub: user.id, shortId: user.shortId, name: user.fullName, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' },
  );
  const refreshToken = jwt.sign({ sub: user.id }, JWT_SECRET, { expiresIn: '30d' });
  return { accessToken, refreshToken };
}

function generateShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let id = '';
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) {
    id += chars[bytes[i]! % chars.length];
  }
  return `PINIT-${id}`;
}

// ── REGISTER ────────────────────────────────────────────────────────────────
export async function faceRegister(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { embedding } = req.body;

    if (!embedding || !Array.isArray(embedding) || embedding.length !== 128) {
      return next(new AppError(400, 'Invalid face embedding. Must be 128-dimensional float array.'));
    }

    const normalized = normalizeEmbedding(embedding as number[]);

    // Check if this face already exists
    const allUsers = await prisma.user.findMany({
      where: { faceRegistered: true },
      select: { id: true, shortId: true, faceEmbedding: true },
    });

    for (const user of allUsers) {
      if (user.faceEmbedding.length === 128) {
        const dist = euclideanDistance(normalized, normalizeEmbedding(user.faceEmbedding));
        if (dist < DUPLICATE_THRESHOLD) {
          res.status(409).json({
            success: false,
            message: 'This face is already registered. Please login instead.',
            shortId: user.shortId,
          });
          return;
        }
      }
    }

    // Create new user with face
    const shortId = generateShortId();
    const user = await prisma.user.create({
      data: {
        shortId,
        fullName: 'PINIT User',
        faceEmbedding: normalized,
        faceRegistered: true,
        faceRegisteredAt: new Date(),
        authMethod: 'face',
        role: 'USER',
      },
    });

    // Log registration
    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
    const ua = req.headers['user-agent'] ?? '';
    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        method: 'face_register',
        ip,
        userAgent: ua,
        success: true,
      },
    });

    const tokens = createTokens({
      id: user.id,
      shortId: user.shortId,
      fullName: user.fullName,
      role: user.role,
    });

    // Store refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    logger.info('Face registration complete', { shortId, userId: user.id });

    res.status(201).json({
      success: true,
      message: 'Face registered successfully',
      user: {
        id: user.id,
        shortId: user.shortId,
        fullName: user.fullName,
        authMethod: 'face',
      },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

// ── LOGIN ───────────────────────────────────────────────────────────────────
export async function faceLogin(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { embedding } = req.body;

    if (!embedding || !Array.isArray(embedding) || embedding.length !== 128) {
      return next(new AppError(400, 'Invalid face embedding. Must be 128-dimensional float array.'));
    }

    const normalized = normalizeEmbedding(embedding as number[]);

    const allUsers = await prisma.user.findMany({
      where: { faceRegistered: true, isActive: true },
      select: {
        id: true, shortId: true, fullName: true, email: true,
        faceEmbedding: true, avatarUrl: true, role: true,
      },
    });

    let bestMatch: typeof allUsers[0] | null = null;
    let bestDistance = Infinity;

    for (const user of allUsers) {
      if (user.faceEmbedding.length !== 128) continue;
      const dist = euclideanDistance(normalized, normalizeEmbedding(user.faceEmbedding));
      if (dist < bestDistance) {
        bestDistance = dist;
        bestMatch = user;
      }
    }

    const ip = req.headers['x-forwarded-for']?.toString().split(',')[0] ?? req.ip;
    const ua = req.headers['user-agent'] ?? '';

    if (!bestMatch || bestDistance >= LOGIN_THRESHOLD) {
      // Log failed attempt
      if (bestMatch) {
        await prisma.loginHistory.create({
          data: {
            userId: bestMatch.id,
            method: 'face_login',
            ip, userAgent: ua,
            success: false,
            failReason: `Distance ${bestDistance.toFixed(4)} exceeds threshold ${LOGIN_THRESHOLD}`,
          },
        });
      }

      res.status(200).json({
        success: false,
        matched: false,
        message: 'No matching face found. Please register first.',
        distance: bestDistance === Infinity ? null : bestDistance.toFixed(4),
      });
      return;
    }

    // Update last login
    await prisma.user.update({
      where: { id: bestMatch.id },
      data: { lastLoginAt: new Date() },
    });

    // Log successful login
    await prisma.loginHistory.create({
      data: {
        userId: bestMatch.id,
        method: 'face_login',
        ip, userAgent: ua,
        success: true,
      },
    });

    const tokens = createTokens({
      id: bestMatch.id,
      shortId: bestMatch.shortId,
      fullName: bestMatch.fullName,
      role: bestMatch.role,
    });

    await prisma.refreshToken.create({
      data: {
        userId: bestMatch.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const confidence = Math.max(0, Math.min(100, Math.round((1 - bestDistance / LOGIN_THRESHOLD) * 100)));

    logger.info('Face login success', {
      shortId: bestMatch.shortId,
      distance: bestDistance.toFixed(4),
      confidence,
    });

    res.status(200).json({
      success: true,
      matched: true,
      confidence,
      distance: bestDistance.toFixed(4),
      user: {
        id: bestMatch.id,
        shortId: bestMatch.shortId,
        fullName: bestMatch.fullName,
        email: bestMatch.email,
        role: bestMatch.role,
      },
      ...tokens,
    });
  } catch (err) {
    next(err);
  }
}

// ── FACE STATUS ─────────────────────────────────────────────────────────────
export async function faceStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = (req as any).user?.sub;
    if (!userId) return next(new AppError(401, 'Not authenticated'));

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { faceRegistered: true, faceRegisteredAt: true, authMethod: true },
    });

    res.json({
      faceRegistered: user?.faceRegistered ?? false,
      faceRegisteredAt: user?.faceRegisteredAt,
      authMethod: user?.authMethod ?? 'password',
    });
  } catch (err) {
    next(err);
  }
}
