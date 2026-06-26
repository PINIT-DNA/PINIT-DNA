import { Router } from 'express';
import { authController } from '../controllers/auth.controller';
import { requireAuth } from '../middleware/auth.middleware';
import { faceRegister, faceLogin, faceStatus } from '../controllers/face-auth.controller';

export const authRouter = Router();

authRouter.post('/create',  authController.createAccount);
authRouter.post('/login',   authController.login);
authRouter.post('/refresh', authController.refresh);
authRouter.post('/logout',  authController.logout);
authRouter.get('/me',       requireAuth, authController.me);

// Face Recognition Auth
authRouter.post('/face/register', faceRegister);
authRouter.post('/face/login',    faceLogin);
authRouter.get('/face/status',    requireAuth, faceStatus);
