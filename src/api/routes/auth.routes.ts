import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { faceRegister, faceLogin, faceStatus } from '../controllers/face-auth.controller';

export const authRouter = Router();

/** Stricter rate limit on biometric endpoints — brute-force protection */
const biometricLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env['NODE_ENV'] === 'production' ? 30 : 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many authentication attempts. Please try again later.' },
});

authRouter.post('/create',  authController.createAccount);
authRouter.post('/login',   authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout',  authController.logout);
authRouter.get('/me',       requireAuth, authController.me);

// Enterprise Biometric Auth (UI contract unchanged)
authRouter.post('/face/register', biometricLimiter, faceRegister);
authRouter.post('/face/login',    biometricLimiter, faceLogin);
authRouter.get('/face/status',    requireAuth, faceStatus);
