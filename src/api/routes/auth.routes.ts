import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { faceRegister, faceLogin, faceIdentify, faceStatus, faceChallenge } from '../controllers/face-auth.controller';
import {
  passkeyRegisterStart,
  passkeyRegisterFinish,
  passkeyLoginStart,
  passkeyLoginFinish,
} from '../controllers/passkey.controller';

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
authRouter.post('/account-type', requireAuth, authController.setAccountType);
authRouter.post('/business-setup', requireAuth, authController.setupBusinessWorkspace);
authRouter.get('/business-setup/status', requireAuth, authController.businessSetupStatus);

// Enterprise Biometric Auth (UI contract unchanged)
authRouter.post('/face/challenge', biometricLimiter, faceChallenge);
authRouter.post('/face/register', biometricLimiter, faceRegister);
authRouter.post('/face/login',    biometricLimiter, faceLogin);
// 1:N sign-in by face alone. Same rate limiter as login — this endpoint is the
// most attractive one to brute-force, since a caller supplies no account claim.
authRouter.post('/face/identify', biometricLimiter, faceIdentify);
authRouter.get('/face/status',    requireAuth, faceStatus);

authRouter.post('/passkey/register/start',  biometricLimiter, passkeyRegisterStart);
authRouter.post('/passkey/register/finish', biometricLimiter, passkeyRegisterFinish);
authRouter.post('/passkey/login/start',     biometricLimiter, passkeyLoginStart);
authRouter.post('/passkey/login/finish',    biometricLimiter, passkeyLoginFinish);
